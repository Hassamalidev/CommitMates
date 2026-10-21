import { activeDays, boardMetrics, boardScores, competitionRanks, type BoardMetrics } from '@commitmates/algorithms';
import {
  boardMembers,
  boardRows,
  getDb,
  getSetting,
  leaderboardUniversities,
  lockBoard,
  upsertBoardRows,
  weeklyContributions,
  type BoardMember,
  type BoardRow,
} from '@commitmates/db';
import { GitHubAuthError, GitHubNotFoundError, SERVER_IDENTITY, fetchContributionDays, githubFor } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { weekStart } from '../adoptions/listings';
import { utcDay } from '../notifications/email';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
const DAYS_PER_WEEK = 7; // allowed-literal: unit conversion
/** ISO 3166-1 alpha-2 country codes, as universities carry them. */
const COUNTRY_CODE_LENGTH = 2;
/** Time kept in hand before the deadline; the rest of a university's members continue in a follow-up. */
const DEADLINE_MARGIN_MS = 4000;

/** The UTC Monday of the week that just ended, for a run on `now` (§8 F19 "Monday 00:00 UTC"). */
export const lastWeekStart = (now: Date): string => weekStart(new Date(now.getTime() - DAYS_PER_WEEK * MS_PER_DAY));

/** `YYYY-MM-DD` `days` later. */
const plusDays = (day: string, days: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY));

/**
 * Active days of one member in a week, from GitHub's contribution calendar (§8 F19 step 1): their own
 * token when valid, the server token otherwise. An account GitHub no longer knows counts as zero.
 */
async function memberActiveDays(member: BoardMember, from: string, to: string, deadline: number): Promise<number> {
  const read = async (identity: Parameters<typeof githubFor>[0]) => activeDays([...(await fetchContributionDays(githubFor(identity), member.login, from, to, { deadline })).values()]);
  try {
    return await read(member.hasToken ? { kind: 'user', userId: member.userId } : SERVER_IDENTITY);
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return 0;
    if (error instanceof GitHubAuthError && member.hasToken) return read(SERVER_IDENTITY);
    throw error;
  }
}

const metricsRecord = (metrics: BoardMetrics): Record<string, number> => ({ ...metrics });

/**
 * Re-ranks one board inside a transaction (§8 F19 steps 4–7): universities by weighted, normalized
 * metrics within their country; departments the same within their university; opted-in members by
 * active days, ties broken by helpful reviews.
 */
async function rerank(scope: BoardRow['scope'], groupId: string, week: string, fresh: readonly BoardRow[], weights: BoardMetrics): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockBoard(scope, groupId, week, tx);
    await upsertBoardRows(fresh, tx);
    const rows = await boardRows(scope, groupId, week, tx);
    let scores: number[];
    let ranks: number[];
    if (scope === 'member') {
      scores = rows.map((row) => row.metrics.activeDays ?? 0);
      ranks = competitionRanks(rows, (a, b) => (b.metrics.activeDays ?? 0) - (a.metrics.activeDays ?? 0) || (b.metrics.helpfulReviews ?? 0) - (a.metrics.helpfulReviews ?? 0));
    } else {
      const metrics = rows.map((row) => ({
        activeRatio: row.metrics.activeRatio ?? 0,
        medianActiveDays: row.metrics.medianActiveDays ?? 0,
        revivals: row.metrics.revivals ?? 0,
        helpfulReviews: row.metrics.helpfulReviews ?? 0,
      }));
      scores = boardScores(metrics, weights);
      ranks = competitionRanks(scores, (a, b) => b - a);
    }
    await upsertBoardRows(
      rows.map((row, index) => ({ ...row, score: scores[index] ?? 0, rank: ranks[index] ?? 0 })),
      tx,
    );
  });
}

const universityPayloadSchema = z.object({
  universityId: z.uuid(),
  countryCode: z.string().length(COUNTRY_CODE_LENGTH),
  weekStart: z.iso.date(),
  /** Active days counted so far, per member, while the run continues. */
  days: z.record(z.string(), z.number().int().min(0)).default({}),
});
type UniversityPayload = z.infer<typeof universityPayloadSchema>;

/**
 * One university's week (§8 F19 steps 1–6): every verified member's active days, then the university's
 * per-capita metrics, its departments' (with at least `leaderboard.minDeptMembers` members) and its
 * opted-in members', each board re-ranked with what is there.
 */
export async function runUniversityWeek(payload: UniversityPayload, deadline: number): Promise<{ status: 'done' } | { status: 'continue'; payload: UniversityPayload }> {
  const members = await boardMembers(payload.universityId);
  const to = plusDays(payload.weekStart, DAYS_PER_WEEK - 1);
  const days = { ...payload.days };
  for (const member of members) {
    if (days[member.userId] !== undefined) continue;
    if (Date.now() > deadline - DEADLINE_MARGIN_MS) return { status: 'continue', payload: { ...payload, days } };
    days[member.userId] = await memberActiveDays(member, payload.weekStart, to, deadline);
  }

  const [minActiveDays, minDeptMembers, weights] = await Promise.all([
    getSetting('leaderboard.minActiveDays'),
    getSetting('leaderboard.minDeptMembers'),
    getSetting('leaderboard.weights'),
  ]);
  const start = new Date(`${payload.weekStart}T00:00:00Z`);
  const contributions = await weeklyContributions(payload.universityId, start, new Date(start.getTime() + DAYS_PER_WEEK * MS_PER_DAY));
  const sum = (ids: readonly string[], counts: Map<string, number>) => ids.reduce((total, id) => total + (counts.get(id) ?? 0), 0);
  const groupMetrics = (group: readonly BoardMember[]) => {
    const ids = group.map((member) => member.userId);
    return boardMetrics(
      ids.map((id) => days[id] ?? 0),
      minActiveDays,
      sum(ids, contributions.revivals),
      sum(ids, contributions.helpfulReviews),
    );
  };
  const row = (scope: BoardRow['scope'], scopeId: string, groupId: string, metrics: Record<string, number>): BoardRow => ({
    scope,
    scopeId,
    groupId,
    weekStart: payload.weekStart,
    metrics,
    score: 0,
    rank: 0,
  });

  await rerank('university', payload.countryCode, payload.weekStart, [row('university', payload.universityId, payload.countryCode, metricsRecord(groupMetrics(members)))], weights);

  const byDepartment = new Map<string, BoardMember[]>();
  for (const member of members) if (member.departmentId) byDepartment.set(member.departmentId, [...(byDepartment.get(member.departmentId) ?? []), member]);
  const departments = [...byDepartment.entries()].filter(([, group]) => group.length >= minDeptMembers);
  await rerank(
    'department',
    payload.universityId,
    payload.weekStart,
    departments.map(([departmentId, group]) => row('department', departmentId, payload.universityId, metricsRecord(groupMetrics(group)))),
    weights,
  );
  await rerank(
    'member',
    payload.universityId,
    payload.weekStart,
    members
      .filter((member) => member.optedIn)
      .map((member) => row('member', member.userId, payload.universityId, { activeDays: days[member.userId] ?? 0, helpfulReviews: contributions.helpfulReviews.get(member.userId) ?? 0 })),
    weights,
  );
  return { status: 'done' };
}

/** `leaderboard_university`: one university's week, continuing until every member is counted. */
export const leaderboardUniversityJob: JobHandler<UniversityPayload> = {
  type: 'leaderboard_university',
  schema: universityPayloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const result = await runUniversityWeek(payload, ctx.deadline);
    return result.status === 'continue' ? { kind: 'continue', payload: result.payload } : { kind: 'done', resultRef: { members: Object.keys(payload.days).length } };
  },
};

const emptyPayload = z.object({});

/** `leaderboard_weekly` (§5.4, Monday 00:00 UTC): one run per university with `unlock.leaderboard.minMembers` verified members. */
export const leaderboardWeeklyJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'leaderboard_weekly',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const week = lastWeekStart(ctx.now());
    const universities = await leaderboardUniversities(await getSetting('unlock.leaderboard.minMembers'));
    for (const university of universities) {
      await enqueue(
        'leaderboard_university',
        { universityId: university.id, countryCode: university.countryCode, weekStart: week },
        { idempotencyKey: `leaderboard:${university.id}:${week}`, priority: PRIORITY.MAINTENANCE },
      );
    }
    return { kind: 'done', resultRef: { queued: universities.length, weekStart: week } };
  },
};
