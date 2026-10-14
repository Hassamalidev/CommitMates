import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { buildUniversityDecks } from './daily';

let database: TestDatabase;
let uni: string;

type Options = { vector?: Record<string, number>; goals?: string[]; ghost?: boolean; hidden?: boolean; verified?: boolean; status?: string };

async function member(options: Options = {}): Promise<string> {
  const id = await insertTestUser(database.sql);
  if (options.status) await database.sql`update users set status = ${options.status} where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, learning_goals, ghost_mode, visibility)
                     values (${id}, 'UTC', ${uni}, ${options.verified === false ? null : new Date()}, ${options.goals ?? []},
                             ${options.ghost ?? false}, ${options.hidden ? 'hidden' : 'university'})`;
  const vector = options.vector ?? { react: 1 };
  await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                     values (${id}, ${database.sql.json(vector)}, ${database.sql.json(vector)}, ${Object.keys(vector)}, '{}', now())`;
  return id;
}

const suggestionsFor = async (userId: string, day: string) =>
  (await database.sql<{ candidate_user_id: string }[]>`
    select candidate_user_id from match_suggestions where user_id = ${userId} and shown_on = ${day}`).map((row) => row.candidate_user_id);

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('match_daily', () => {
  it('builds decks that leave out blocked, connected, hidden, ghost, suspended and unverified people', async () => {
    const me = await member({ goals: ['ml'] });
    const friend = await member();
    const blocker = await member();
    const connected = await member();
    const ghost = await member({ ghost: true });
    const hidden = await member({ hidden: true });
    const suspended = await member({ status: 'suspended' });
    const unverified = await member({ verified: false });
    const mentor = await member({ vector: { ml: 1, react: 0.2 } });
    await database.sql`insert into blocks (blocker, blocked) values (${blocker}, ${me})`;
    const [a, b] = [me, connected].sort();
    await database.sql`insert into connections (user_a, user_b, source) values (${a!}, ${b!}, 'match')`;

    const day = '2026-10-14';
    expect(await buildUniversityDecks(uni, day)).toBeGreaterThan(0);
    const mine = await suggestionsFor(me, day);
    expect(mine).toEqual(expect.arrayContaining([friend, mentor]));
    for (const excluded of [blocker, connected, ghost, hidden, suspended, unverified, me]) expect(mine).not.toContain(excluded);
    // The block works both ways, and invisible members still receive their own deck.
    expect(await suggestionsFor(blocker, day)).not.toContain(me);
    expect((await suggestionsFor(ghost, day)).length).toBeGreaterThan(0);
    expect(await suggestionsFor(unverified, day)).toEqual([]);

    // A mentor who covers the goal ranks first in teammate mode.
    const [teammate] = await database.sql<{ candidate_user_id: string; explanation_keys: { coverage: string[] } }[]>`
      select candidate_user_id, explanation_keys from match_suggestions
      where user_id = ${me} and shown_on = ${day} and mode = 'teammate' order by score desc limit 1`;
    expect(teammate).toMatchObject({ candidate_user_id: mentor, explanation_keys: { coverage: ['ml'] } });

    // A rerun on the same day keeps what was shown.
    expect(await buildUniversityDecks(uni, day)).toBe(0);
  });

  it('runs nightly only where matching is unlocked', async () => {
    const before = (await database.sql`select count(*)::int as count from match_suggestions where shown_on = current_date`)[0]?.count as number;
    await withSettings({ 'unlock.matching.minMembers': 1000 }, async () => {
      const job = await enqueue('match_daily', {}, { idempotencyKey: 'match-daily:locked' });
      await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    });
    expect((await database.sql`select count(*)::int as count from match_suggestions where shown_on = current_date`)[0]?.count).toBe(before);

    await withSettings({ 'unlock.matching.minMembers': 2 }, async () => {
      const job = await enqueue('match_daily', {}, { idempotencyKey: 'match-daily:open' });
      await runTick({ budgetMs: 30_000, onlyJobId: job.id });
      const [row] = await database.sql`select status, result_ref from jobs where id = ${job.id}`;
      expect(row).toMatchObject({ status: 'done', result_ref: { universities: 1 } });
    });
  });
});
