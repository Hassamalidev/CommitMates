import { createMswServer } from '@commitmates/config/testing/msw';
import { encrypt, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getStreakShare, getStreaks, partnerTodayStatus } from './service';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let counter = 0;
let calls = 0;
let todayCount = 0;
const reset = () => Math.floor(Date.now() / 1000) + 3600;

type Options = { share?: boolean; visibility?: string; palette?: string };

async function member(options: Options = {}): Promise<{ id: string; login: string }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `status-${n}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at, share_today_status, visibility)
                     values (${id}, 'Asia/Tokyo', now(), ${options.share ?? true}, ${options.visibility ?? 'university'})`;
  await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                     values (${id}, ${950_000 + n}, ${login}, ${encrypt(`gho_status_${n}`)}, 1)`;
  if (options.palette) {
    await database.sql`insert into persona_snapshots (user_id, metrics, labels, companion, computed_at)
                       values (${id}, '{}', '{}', ${database.sql.json({ seed: n, speciesKey: 'go', paletteHex: options.palette, stage: 1, traits: [] })}, now())`;
  }
  return { id, login };
}

async function pairOf(a: { id: string }, b: { id: string }, status = 'active'): Promise<string> {
  const [userA, userB] = [a.id, b.id].sort();
  const [row] = await database.sql<{ id: string }[]>`
    insert into pairs (user_a, user_b, status, current_streak, longest_streak) values (${userA!}, ${userB!}, ${status}, 4, 9) returning id`;
  await database.sql`insert into pair_companions (pair_id, seed, stage, mood) values (${row!.id}, 77, 1, 'happy')`;
  return row!.id;
}

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
  calls = 0;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset: reset() }, graphql: { limit: 5000, remaining: 4900, reset: reset() } } })),
    http.post(`${API}/graphql`, async ({ request }) => {
      calls += 1;
      const { variables } = (await request.json()) as { variables: { from: string } };
      const day = variables.from.slice(0, 10);
      return HttpResponse.json({
        data: {
          user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: [{ date: day, contributionCount: todayCount }] }] } } },
          rateLimit: { limit: 5000, cost: 1, remaining: 4990, resetAt: new Date(reset() * 1000).toISOString() },
        },
      });
    }),
  );
});

describe('partner status and palettes', () => {
  it('tells whether the partner coded today in their own day, reusing the answer for a while', async () => {
    const [me, partner] = [await member(), await member({ palette: '#00add8' })];
    const pairId = await pairOf(me, partner);
    todayCount = 0;
    expect(await partnerTodayStatus(me, { pairId })).toBe('not_yet');
    todayCount = 3;
    // Still the cached answer.
    expect(await partnerTodayStatus(me, { pairId })).toBe('not_yet');
    expect(calls).toBe(1);
    await database.sql`delete from analysis_cache where kind = 'today_status'`;
    expect(await partnerTodayStatus(me, { pairId })).toBe('coded');

    const [card] = (await getStreaks(me)).pairs;
    expect(card?.palettes).toEqual({ mine: null, partner: '#00add8' });
  });

  it('stays private when the partner does not share it, and refuses pairs that are not the member’s', async () => {
    const [me, partner, stranger] = [await member(), await member({ share: false }), await member()];
    const pairId = await pairOf(me, partner);
    expect(await partnerTodayStatus(me, { pairId })).toBe('private');
    expect(calls).toBe(0);
    await expect(partnerTodayStatus(stranger, { pairId })).rejects.toMatchObject({ code: 'streaks.pair_missing' });
  });
});

describe('share card', () => {
  it('exists only for a pair that has not ended, between two public members', async () => {
    const [a, b] = [await member({ visibility: 'public', palette: '#3178c6' }), await member({ visibility: 'public' })];
    const shared = await pairOf(a, b);
    expect(await getStreakShare(shared)).toMatchObject({
      currentStreak: 4,
      longestStreak: 9,
      companion: { seed: 77, stage: 1, mood: 'happy' },
    });
    const [c, d] = [await member({ visibility: 'public' }), await member()];
    expect(await getStreakShare(await pairOf(c, d))).toBeNull();
    const [e, f] = [await member({ visibility: 'public' }), await member({ visibility: 'public' })];
    expect(await getStreakShare(await pairOf(e, f, 'ended'))).toBeNull();
    expect(await getStreakShare('not-a-pair')).toBeNull();
  });
});
