import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getLeaderboards, lastWeekStart, runUniversityWeek, setLeaderboardOptIn } from './service';

const API = 'https://api.github.com';
/** The current week, so rows the database stamps with `now()` (settled reviews) fall inside it. */
const WEEK = lastWeekStart(new Date(Date.now() + 7 * 86_400_000));
const server = createMswServer();
let database: TestDatabase;
let counter = 0;
/** Days with a contribution per login in the test week. */
const activity = new Map<string, number>();

const reset = () => Math.floor(Date.now() / 1000) + 3600;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, graphql: { limit: 5000, remaining: 4990, reset: reset() } } })),
    http.post(`${API}/graphql`, async ({ request }) => {
      const body = (await request.json()) as { variables: { login: string; from: string } };
      const active = activity.get(body.variables.login) ?? 0;
      // The seven requested days; the first `active` have contributions (one a burst that still counts once).
      const first = Date.parse(body.variables.from.slice(0, 10));
      const contributionDays = Array.from({ length: 7 }, (_, index) => ({
        date: new Date(first + index * 86_400_000).toISOString().slice(0, 10),
        contributionCount: index < active ? (index === 0 ? 40 : 1) : 0,
      }));
      return HttpResponse.json({
        data: {
          user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays }] } } },
          rateLimit: { limit: 5000, cost: 1, remaining: 4990, resetAt: new Date(reset() * 1000).toISOString() },
        },
      });
    }),
  );
});

async function university(code = 'TL'): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`Board Uni ${counter}`}, ${`board-uni-${counter}`}, 'Testland', ${code}, '{}', 'admin', 'b') returning id`;
  return row!.id;
}

async function member(universityId: string, active: number, extra: { departmentId?: string; optIn?: boolean } = {}): Promise<string> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `board-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, department_id) values (${id}, 'UTC', ${universityId}, now(), ${extra.departmentId ?? null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${880_000 + counter}, ${login})`;
  if (extra.optIn) await database.sql`insert into leaderboard_optins (user_id) values (${id})`;
  activity.set(login, active);
  return id;
}

const rows = (scope: string, groupId: string) =>
  database.sql<{ scope_id: string; metrics: Record<string, number>; rank: number; score: number }[]>`
    select scope_id, metrics, rank, score from leaderboard_snapshots where scope = ${scope} and group_id = ${groupId} and week_start = ${WEEK} order by rank, scope_id`;

describe('lastWeekStart', () => {
  it('is the Monday of the week that just ended', () => {
    expect(lastWeekStart(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-12');
    expect(lastWeekStart(new Date('2026-10-21T15:00:00Z'))).toBe('2026-10-12');
  });
});

describe('runUniversityWeek', () => {
  it('ranks universities per capita within their country, departments within their university and only opted-in members', async () => {
    const small = await university();
    const large = await university();
    const [dept] = await database.sql<{ id: string }[]>`
      insert into departments (university_id, name, normalized_name) values (${small}, 'Computing', 'computing') returning id`;
    // Four active members of five at the small university; one active of ten at the large one.
    const smallMembers = [
      await member(small, 6, { departmentId: dept!.id, optIn: true }),
      await member(small, 5, { departmentId: dept!.id, optIn: true }),
      await member(small, 4, { departmentId: dept!.id }),
      await member(small, 3, { departmentId: dept!.id }),
      await member(small, 0, { departmentId: dept!.id, optIn: true }),
    ];
    for (let index = 0; index < 10; index += 1) await member(large, index === 0 ? 7 : 0);
    // A helpful review this week breaks a tie between two opted-in members later.
    const [request] = await database.sql<{ id: string }[]>`
      insert into review_requests (author_user_id, university_id, pr_url, repo_full_name, pr_number, languages, status, expires_at, updated_at)
      values (${smallMembers[2]!}, ${small}, 'https://github.com/a/b/pull/1', 'a/b', 1, '{}', 'settled_helpful', now(), now()) returning id`;
    await database.sql`insert into reviews (request_id, reviewer_user_id, gh_review_ids, line_comment_count, verified_at, rating)
                       values (${request!.id}, ${smallMembers[1]!}, '{1}', 3, now(), 'helpful')`;

    await withSettings({ 'leaderboard.minDeptMembers': 5 }, async () => {
      for (const universityId of [small, large]) {
        expect(await runUniversityWeek({ universityId, countryCode: 'TL', weekStart: WEEK, days: {} }, Date.now() + 30_000)).toEqual({ status: 'done' });
      }
    });

    const universities = await rows('university', 'TL');
    expect(universities.map((row) => [row.scope_id, row.rank])).toEqual([
      [small, 1],
      [large, 2],
    ]);
    expect(universities[0]?.metrics).toMatchObject({ activeRatio: 0.8, medianActiveDays: 4, helpfulReviews: 1 });
    expect(universities[1]?.metrics).toMatchObject({ activeRatio: 0.1, medianActiveDays: 0 });

    expect((await rows('department', small)).map((row) => row.scope_id)).toEqual([dept!.id]);
    expect(await rows('department', large)).toEqual([]);

    const people = await rows('member', small);
    expect(people.map((row) => [row.scope_id, row.rank, row.metrics.activeDays])).toEqual([
      [smallMembers[0], 1, 6],
      [smallMembers[1], 2, 5],
      [smallMembers[4], 3, 0],
    ]);
  });

  it('continues when the deadline is near, keeping the days counted so far', async () => {
    const uni = await university('XE');
    await member(uni, 2);
    await member(uni, 3);
    // No time left before the margin: nothing is counted yet, and the run continues.
    const first = await runUniversityWeek({ universityId: uni, countryCode: 'XE', weekStart: WEEK, days: {} }, Date.now() + 1_000);
    expect(first.status).toBe('continue');
    if (first.status !== 'continue') return;
    expect(Object.keys(first.payload.days).length).toBeLessThan(2);
    expect(await runUniversityWeek(first.payload, Date.now() + 30_000)).toEqual({ status: 'done' });
    expect((await rows('university', 'XE'))[0]?.metrics).toMatchObject({ activeRatio: 0.5 });
  });
});

describe('getLeaderboards and the opt-in', () => {
  it('shows a member their country’s universities, their departments and opted-in classmates, and lets them leave', async () => {
    const uni = await university('LB');
    const other = await university('LB');
    const viewer = await member(uni, 5, { optIn: true });
    await member(uni, 1);
    await member(other, 0);
    for (const universityId of [uni, other]) await runUniversityWeek({ universityId, countryCode: 'LB', weekStart: WEEK, days: {} }, Date.now() + 30_000);

    const actor = { id: viewer, verified: true, universityId: uni };
    await withSettings({ 'unlock.leaderboard.minMembers': 10_000 }, async () => {
      expect(await getLeaderboards(actor)).toMatchObject({ state: 'locked', required: 10_000 });
    });
    const view = await withSettings({ 'unlock.leaderboard.minMembers': 1 }, () => getLeaderboards(actor));
    expect(view.state).toBe('open');
    if (view.state !== 'open') return;
    expect(view.universities.weekStart).toBe(WEEK);
    expect(view.universities.entries.map((entry) => [entry.scopeId, entry.rank, entry.isViewer])).toEqual([
      [uni, 1, true],
      [other, 2, false],
    ]);
    expect(view.universities.entries[0]?.name).toMatch(/^Board Uni /);
    expect(view.universities.entries[0]?.companion.stage).toBe(0);
    expect(view.members.entries.map((entry) => [entry.name, entry.isViewer])).toEqual([[expect.stringMatching(/^board-/), true]]);
    expect(view.optedIn).toBe(true);
    expect(view.rules.weights.activeRatio).toBe(0.5);

    expect(await setLeaderboardOptIn(actor, { optIn: false })).toBe(false);
    const after = await withSettings({ 'unlock.leaderboard.minMembers': 1 }, () => getLeaderboards(actor));
    expect(after.state === 'open' ? [after.optedIn, after.members.entries.length] : null).toEqual([false, 0]);
    expect(await getLeaderboards({ id: viewer, verified: false, universityId: null })).toEqual({ state: 'unverified' });
  });
});
