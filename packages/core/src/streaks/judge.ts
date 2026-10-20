import { addDays, judgeDay, judgeableAt, moodAfter, pairCompanionStage, seedFrom, type StreakState } from '@commitmates/algorithms';
import {
  activePairs,
  getDb,
  getLogin,
  getSetting,
  insertNotification,
  insertPairDay,
  lockPair,
  updatePairState,
  upsertPairCompanion,
} from '@commitmates/db';
import { GitHubAuthError, fetchContributionDays, githubFor } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { getMember } from '../profiles/service';

/** Length of `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

/** The first day a pair is judged: the UTC date it was created. */
export const firstPairDay = (createdAt: Date): string => createdAt.toISOString().slice(0, ISO_DATE_LENGTH);

/** The next day a pair waits to have judged. */
export const nextPairDay = (pair: { lastJudgedDay: string | null; createdAt: Date }): string =>
  pair.lastJudgedDay === null ? firstPairDay(pair.createdAt) : addDays(pair.lastJudgedDay, 1);

async function streakParams() {
  const [minDaily, freezeEveryDays, maxFreezes, pauseAfterMissedDays, graceHours, stageDays] = await Promise.all([
    getSetting('streaks.minDailyContributions'),
    getSetting('streaks.freezeEveryDays'),
    getSetting('streaks.maxFreezes'),
    getSetting('streaks.pauseAfterMissedDays'),
    getSetting('streaks.graceHours'),
    getSetting('streaks.companionStageDays'),
  ]);
  return { judge: { minDaily, freezeEveryDays, maxFreezes, pauseAfterMissedDays }, graceHours, stageDays };
}

/**
 * Each member's contributions per day over `[from, to]`, read with their own token. Null for a member
 * whose token is missing or rejected: their days are skipped, not missed, and they are asked to sign
 * in again (CLAUDE.md §8 F13 "Edge cases").
 */
async function readCounts(userId: string, from: string, to: string, deadline: number): Promise<Map<string, number> | null> {
  const member = await getMember(userId);
  if (!member?.hasValidToken || member.login === null) return null;
  try {
    return await fetchContributionDays(githubFor({ kind: 'user', userId }), member.login, from, to, { deadline });
  } catch (error) {
    if (error instanceof GitHubAuthError) return null;
    throw error;
  }
}

const payloadSchema = z.union([z.object({ pairId: z.uuid(), day: z.string() }), z.object({})]);
type StreakPayload = z.infer<typeof payloadSchema>;

/**
 * Shared streak judgement (CLAUDE.md §8 F13 "Daily judgement", §5.4 `streak_check`). The hourly
 * scheduled run queues each active pair whose next day is over for both members (in their own
 * timezones, plus `streaks.graceHours`), once per pair and day. A pair's run judges every day that is
 * ready, in order: counts as GitHub's calendar reports them, then counted, frozen or missed; a member
 * whose token is invalid makes the day skipped instead. The companion's stage and mood follow, and
 * after `streaks.pauseAfterMissedDays` misses in a row the pair pauses and both are told.
 */
export const streakCheckJob: JobHandler<StreakPayload> = {
  type: 'streak_check',
  schema: payloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const now = ctx.now();
    const params = await streakParams();

    if (!('pairId' in payload)) {
      let queued = 0;
      for (const pair of await activePairs()) {
        const day = nextPairDay(pair);
        if (judgeableAt(day, [pair.timezoneA, pair.timezoneB], params.graceHours) > now) continue;
        await enqueue('streak_check', { pairId: pair.id, day }, { idempotencyKey: `streak:${pair.id}:${day}`, priority: PRIORITY.USER_BG });
        queued += 1;
      }
      return { kind: 'done', resultRef: { queued } };
    }

    const pair = (await activePairs()).find((entry) => entry.id === payload.pairId);
    if (!pair || nextPairDay(pair) !== payload.day) return { kind: 'done', resultRef: { skipped: 'already_judged' } };
    const zones = [pair.timezoneA, pair.timezoneB];
    const days: string[] = [];
    for (let day = payload.day; judgeableAt(day, zones, params.graceHours) <= now; day = addDays(day, 1)) days.push(day);
    const last = days.at(-1);
    if (last === undefined) return { kind: 'done', resultRef: { skipped: 'not_ready' } };

    const [countsA, countsB] = await Promise.all([
      readCounts(pair.userA, payload.day, last, ctx.deadline),
      readCounts(pair.userB, payload.day, last, ctx.deadline),
    ]);

    const result = await getDb().transaction(async (tx) => {
      const locked = await lockPair(pair.id, tx);
      if (locked?.status !== 'active' || nextPairDay(locked) !== payload.day) return { judged: 0, paused: false };
      let state: StreakState = {
        currentStreak: locked.currentStreak,
        longestStreak: locked.longestStreak,
        freezes: locked.freezesAvailable,
        missedInRow: locked.missedInRow,
      };
      let mood: 'happy' | 'neutral' | 'sad' | null = null;
      let paused = false;
      for (const day of days) {
        if (countsA !== null && countsB !== null) {
          const counts = { a: countsA.get(day) ?? 0, b: countsB.get(day) ?? 0 };
          const judged = judgeDay(state, counts, params.judge);
          await insertPairDay({ pairId: pair.id, day, aCount: counts.a, bCount: counts.b, outcome: judged.outcome }, tx);
          state = judged.state;
          mood = moodAfter(judged.outcome);
          paused = judged.paused;
        }
        await updatePairState(
          pair.id,
          {
            currentStreak: state.currentStreak,
            longestStreak: state.longestStreak,
            freezesAvailable: state.freezes,
            missedInRow: state.missedInRow,
            lastJudgedDay: day,
            ...(paused ? { status: 'paused' as const } : {}),
          },
          tx,
        );
        if (paused) break;
      }
      if (mood !== null) await upsertPairCompanion(pair.id, seedFrom(pair.id), pairCompanionStage(state.currentStreak, params.stageDays), mood, tx);
      if (paused) {
        const [loginA, loginB] = await Promise.all([getLogin(pair.userA, tx), getLogin(pair.userB, tx)]);
        await insertNotification(pair.userA, 'pair_paused', { login: loginB }, tx);
        await insertNotification(pair.userB, 'pair_paused', { login: loginA }, tx);
      }
      for (const [userId, counts] of [
        [pair.userA, countsA],
        [pair.userB, countsB],
      ] as const) {
        if (counts === null) await insertNotification(userId, 'github_reconnect', {}, tx);
      }
      return { judged: days.length, paused };
    });
    return { kind: 'done', resultRef: result };
  },
};
