import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { getSocialMetrics } from '../metrics/service';
import { ENDED_STREAK_SAMPLE } from '../streaks/judge';

import { tuneMatchWeights } from './tune';

let database: TestDatabase;
const DAY = new Date().toISOString().slice(0, 10);

async function member(): Promise<string> {
  const id = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, 'UTC', now())`;
  return id;
}

type Components = { sim: number; int: number; comp: number };

/**
 * A suggestion in `mode` that was acted on; when `messages` is given it was requested, accepted, and
 * each side then sent that many messages.
 */
async function suggestion(mode: string, components: Components, messages: number | null): Promise<void> {
  const [user, candidate] = [await member(), await member()];
  const [row] = await database.sql<{ id: string }[]>`
    insert into match_suggestions (user_id, candidate_user_id, mode, score, components, explanation_keys, shown_on, action, acted_at)
    values (${user}, ${candidate}, ${mode}, 0.5, ${database.sql.json(components)}, '{}', ${DAY}, ${messages === null ? 'skipped' : 'requested'}, now())
    returning id`;
  if (messages === null) return;
  await database.sql`insert into message_requests (from_user, to_user, context_kind, context_id, first_message, status, responded_at)
                     values (${user}, ${candidate}, 'discover', ${row!.id}, 'hello there', 'accepted', now())`;
  const [thread] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
  await database.sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${user}), (${thread!.id}, ${candidate})`;
  for (let index = 0; index < messages; index += 1) {
    await database.sql`insert into messages (thread_id, author_user_id, body) values (${thread!.id}, ${user}, 'hi'), (${thread!.id}, ${candidate}, 'hey')`;
  }
}

const computedWeights = async () =>
  (await database.sql<{ computed_value: Record<string, Components> | null; sample_size: number }[]>`
    select computed_value, sample_size from settings where key = 'matching.weights'`)[0];

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
  await database.sql`truncate match_suggestions, message_requests, threads cascade`;
  await database.sql`update settings set computed_value = null, sample_size = 0 where key = 'matching.weights'`;
});

describe('tune_match_weights', () => {
  it('waits for enough successes before changing anything', async () => {
    await suggestion('teammate', { sim: 0.1, int: 0.2, comp: 0.9 }, 4);
    await suggestion('teammate', { sim: 0.8, int: 0.2, comp: 0.1 }, null);
    const report = await withSettings({ 'matching.tuneMinSuccesses': 2 }, () => tuneMatchWeights());
    expect(report.tuned).toEqual([]);
    expect((await computedWeights())?.computed_value).toBeNull();
  });

  it('counts only matches where both sides kept talking', async () => {
    // Accepted, but each side sent only one message: not a success.
    await suggestion('teammate', { sim: 0.1, int: 0.2, comp: 0.9 }, 1);
    const report = await withSettings({ 'matching.tuneMinSuccesses': 1, 'matching.successMessages': 2 }, () => tuneMatchWeights());
    expect(report.successes.teammate).toBe(0);
  });

  it('moves a mode toward what successful matches had, by at most the step, and records it', async () => {
    for (let index = 0; index < 3; index += 1) await suggestion('teammate', { sim: 0.1, int: 0.3, comp: 0.9 }, 4);
    for (let index = 0; index < 3; index += 1) await suggestion('teammate', { sim: 0.9, int: 0.3, comp: 0.1 }, null);
    await suggestion('study', { sim: 0.9, int: 0.3, comp: 0.1 }, null);

    await withSettings({ 'matching.tuneMinSuccesses': 3, 'matching.weightStep': 0.05 }, async () => {
      const job = await enqueue('tune_match_weights', {});
      await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    });
    const stored = await computedWeights();
    const teammate = stored?.computed_value?.teammate;
    expect(teammate).toBeDefined();
    // Defaults: teammate { sim: 0.2, int: 0.2, comp: 0.6 }.
    expect(teammate!.comp).toBeGreaterThan(0.6);
    expect(teammate!.sim).toBeLessThan(0.2);
    for (const [key, before] of Object.entries({ sim: 0.2, int: 0.2, comp: 0.6 })) {
      expect(Math.abs(teammate![key as keyof Components] - before)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    expect(teammate!.sim + teammate!.int + teammate!.comp).toBeCloseTo(1, 10);
    // Study had no successes and keeps its weights.
    expect(stored?.computed_value?.study).toEqual({ sim: 0.6, int: 0.3, comp: 0.1 });
    expect(stored?.sample_size).toBe(3);
    expect(await database.sql`select 1 from settings_history where key = 'matching.weights' and field = 'computed'`).toHaveLength(1);
  });
});

describe('social metrics', () => {
  it('reports match quality and the median age of active pairs', async () => {
    await suggestion('study', { sim: 0.5, int: 0.5, comp: 0.5 }, 4);
    await suggestion('study', { sim: 0.5, int: 0.5, comp: 0.5 }, 1);
    const [a, b, c, d] = await Promise.all([member(), member(), member(), member()]);
    const ordered = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
    const [p1, p2] = [ordered(a, b), ordered(c, d)];
    await database.sql`insert into pairs (user_a, user_b, created_at) values (${p1[0]}, ${p1[1]}, now() - interval '4 days'), (${p2[0]}, ${p2[1]}, now() - interval '10 days')`;
    const metrics = await getSocialMetrics();
    expect(metrics.matchQuality).toMatchObject({ accepted: 2, successful: 1, rate: 0.5 });
    expect(metrics.streaks.activePairs).toBe(2);
    expect(metrics.streaks.medianDays).toBeCloseTo(7, 1);
  });
});

describe('streaks.companionStageDays recompute', () => {
  it('derives whole, increasing stage days from ended-streak lengths once enough exist', async () => {
    const lengths = Array.from({ length: 30 }, (_, index) => index + 1);
    for (const [index, value] of lengths.entries()) {
      await database.sql`insert into metric_samples (metric_key, value, subject_hash, salt_period, recorded_on)
                         values (${ENDED_STREAK_SAMPLE}, ${value}, ${`hash-${index}`}, 1, current_date)`;
    }
    const job = await enqueue('recompute_settings', {});
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    const [row] = await database.sql<{ computed_value: number[]; sample_size: number }[]>`
      select computed_value, sample_size from settings where key = 'streaks.companionStageDays'`;
    expect(row?.sample_size).toBe(30);
    expect(row?.computed_value).toEqual([6, 11, 16, 20, 25]);
  });
});
