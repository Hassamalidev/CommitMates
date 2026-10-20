import { addDays } from '@commitmates/algorithms';
import { createMswServer } from '@commitmates/config/testing/msw';
import { encrypt, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { enqueue, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let counter = 0;

/** Contributions per login and date that the mocked calendar reports. */
const calendar = new Map<string, Map<string, number>>();
const today = new Date().toISOString().slice(0, 10);
const reset = () => Math.floor(Date.now() / 1000) + 3600;

async function member(options: { timezone?: string; tokenInvalid?: boolean } = {}): Promise<{ id: string; login: string }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `streak-${n}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, ${options.timezone ?? 'UTC'}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version, token_invalid)
                     values (${id}, ${800_000 + n}, ${login}, ${encrypt(`gho_test_${n}`)}, 1, ${options.tokenInvalid ?? false})`;
  return { id, login };
}

/** A pair created `daysAgo` UTC days ago, holding `freezes`. */
async function pair(a: { id: string }, b: { id: string }, daysAgo: number, freezes = 0): Promise<string> {
  const [userA, userB] = [a.id, b.id].sort();
  const [row] = await database.sql<{ id: string }[]>`
    insert into pairs (user_a, user_b, freezes_available, created_at)
    values (${userA!}, ${userB!}, ${freezes}, ${`${addDays(today, -daysAgo)}T12:00:00Z`}) returning id`;
  return row!.id;
}

const counts = (login: string, entries: Record<string, number>) => calendar.set(login, new Map(Object.entries(entries)));

/** The dispatch run, then every per-pair run it queued. */
async function judge(): Promise<void> {
  const dispatch = await enqueue('streak_check', {}, { idempotencyKey: `dispatch:${Math.random()}` });
  await runTick({ budgetMs: 30_000, onlyJobId: dispatch.id });
  const queued = await database.sql<{ id: string }[]>`select id from jobs where type = 'streak_check' and status = 'queued' and payload ? 'pairId'`;
  for (const { id } of queued) await runTick({ budgetMs: 30_000, onlyJobId: id });
}

const pairRow = async (id: string) =>
  (await database.sql<{ status: string; current_streak: number; longest_streak: number; freezes_available: number; missed_in_row: number; last_judged_day: string | null }[]>`
    select status, current_streak, longest_streak, freezes_available, missed_in_row, last_judged_day::text from pairs where id = ${id}`)[0];
const days = async (id: string) =>
  (await database.sql<{ day: string; outcome: string }[]>`select day::text, outcome from pair_days where pair_id = ${id} order by day`).map(
    (row) => [row.day, row.outcome],
  );

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  calendar.clear();
  await database.sql`delete from jobs`;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset: reset() }, graphql: { limit: 5000, remaining: 4900, reset: reset() } } })),
    http.post(`${API}/graphql`, async ({ request }) => {
      const { variables } = (await request.json()) as { variables: { login: string; from: string; to: string } };
      const from = variables.from.slice(0, 10);
      const to = variables.to.slice(0, 10);
      const contributionDays: { date: string; contributionCount: number }[] = [];
      for (let day = from; day <= to; day = addDays(day, 1)) contributionDays.push({ date: day, contributionCount: calendar.get(variables.login)?.get(day) ?? 0 });
      return HttpResponse.json({
        data: {
          user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays }] } } },
          rateLimit: { limit: 5000, cost: 1, remaining: 4990, resetAt: new Date(reset() * 1000).toISOString() },
        },
      });
    }),
  );
});

describe('streak_check', () => {
  it('judges every finished day in order: counted, frozen with the held freeze, counted again', async () => {
    const [a, b] = [await member(), await member()];
    const pairId = await pair(a, b, 3, 1);
    const [d1, d2, d3] = [addDays(today, -3), addDays(today, -2), addDays(today, -1)];
    counts(a.login, { [d1]: 2, [d2]: 1, [d3]: 4 });
    counts(b.login, { [d1]: 1, [d2]: 0, [d3]: 1 });

    await withSettings({ 'streaks.graceHours': 0 }, judge);
    expect(await days(pairId)).toEqual([
      [d1, 'counted'],
      [d2, 'frozen'],
      [d3, 'counted'],
    ]);
    expect(await pairRow(pairId)).toEqual({
      status: 'active',
      current_streak: 2,
      longest_streak: 2,
      freezes_available: 0,
      missed_in_row: 0,
      last_judged_day: d3,
    });
    const [companion] = await database.sql`select stage, mood from pair_companions where pair_id = ${pairId}`;
    expect(companion).toEqual({ stage: 0, mood: 'happy' });

    // Today is not over yet: nothing more to judge, and judging again changes nothing.
    await withSettings({ 'streaks.graceHours': 0 }, judge);
    expect(await days(pairId)).toHaveLength(3);
  });

  it('pauses the pair after misses in a row and tells both members', async () => {
    const [a, b] = [await member(), await member()];
    const pairId = await pair(a, b, 4);
    await withSettings({ 'streaks.graceHours': 0, 'streaks.pauseAfterMissedDays': 3 }, judge);
    expect((await days(pairId)).map(([, outcome]) => outcome)).toEqual(['missed', 'missed', 'missed']);
    expect(await pairRow(pairId)).toMatchObject({ status: 'paused', current_streak: 0, missed_in_row: 3, last_judged_day: addDays(today, -2) });
    const notified = await database.sql<{ user_id: string; data: { login: string } }[]>`
      select user_id, data from notifications where kind = 'pair_paused' and user_id in ${database.sql([a.id, b.id])} order by user_id`;
    expect(notified.map((row) => [row.user_id, row.data.login]).sort()).toEqual([
      [a.id, b.login],
      [b.id, a.login],
    ].sort());
  });

  it('skips days, without missing them, while a member’s GitHub token is invalid, and asks them to sign in again', async () => {
    const [a, b] = [await member(), await member({ tokenInvalid: true })];
    const pairId = await pair(a, b, 2);
    counts(a.login, { [addDays(today, -2)]: 1, [addDays(today, -1)]: 1 });
    await withSettings({ 'streaks.graceHours': 0 }, judge);
    expect(await days(pairId)).toEqual([]);
    expect(await pairRow(pairId)).toMatchObject({ status: 'active', current_streak: 0, missed_in_row: 0, last_judged_day: addDays(today, -1) });
    expect(await database.sql`select 1 from notifications where user_id = ${b.id} and kind = 'github_reconnect'`).toHaveLength(1);
  });

  it('waits until the day is over for both members, in their own timezones', async () => {
    const [a, b] = [await member({ timezone: 'Pacific/Kiritimati' }), await member({ timezone: 'Pacific/Pago_Pago' })];
    const pairId = await pair(a, b, 0);
    // Today in UTC ends for Pago Pago (UTC−11) only tomorrow at 11:00 UTC.
    await judge();
    expect(await database.sql`select 1 from jobs where type = 'streak_check' and payload->>'pairId' = ${pairId}`).toHaveLength(0);
    expect((await pairRow(pairId))?.last_judged_day).toBeNull();
  });
});
