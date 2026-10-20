import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

let database: TestDatabase;

async function member(options: { ageDays: number; verified: boolean }): Promise<string> {
  const id = await insertTestUser(database.sql);
  await database.sql`update users set created_at = now() - make_interval(days => ${options.ageDays}) where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, 'UTC', ${options.verified ? new Date() : null})`;
  return id;
}

async function sendRequests(from: string, statuses: string[]): Promise<void> {
  for (const status of statuses) {
    const to = await member({ ageDays: 100, verified: true });
    await database.sql`insert into message_requests (from_user, to_user, context_kind, first_message, status)
                       values (${from}, ${to}, 'discover', 'hello there', ${status})`;
  }
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('compute_trust', () => {
  it('scores every member from age, verification, accept rate and distinct verified reporters', async () => {
    const steady = await member({ ageDays: 15, verified: true });
    await sendRequests(steady, ['accepted', 'accepted', 'accepted', 'declined']);
    const reported = await member({ ageDays: 60, verified: true });
    const [r1, r2, unverified] = [
      await member({ ageDays: 100, verified: true }),
      await member({ ageDays: 100, verified: true }),
      await member({ ageDays: 100, verified: false }),
    ];
    // r1 twice, r2 once but dismissed, an unverified reporter: only r1 counts.
    await database.sql`insert into reports (reporter, target_user, reason, status) values
      (${r1}, ${reported}, 'spam', 'open'), (${r1}, ${reported}, 'harassment', 'open'),
      (${r2}, ${reported}, 'spam', 'dismissed'), (${unverified}, ${reported}, 'spam', 'open')`;

    const job = await enqueue('compute_trust', {});
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });

    const rows = await database.sql<{ user_id: string; score: number; multiplier: number; components: Record<string, number> }[]>`
      select user_id, score, multiplier, components from trust_scores where user_id in ${database.sql([steady, reported])}`;
    const byUser = new Map(rows.map((row) => [row.user_id, row]));
    // 0.25·0.5 + 0.25·1 + 0.3·0.75 − 0.2·0 = 0.6, mapped onto [0.5, 3] → 2.0
    expect(byUser.get(steady)?.components).toMatchObject({ verified: 1, acceptRate: 0.75, reports: 0 });
    expect(byUser.get(steady)?.components.age).toBeCloseTo(0.5, 2);
    expect(byUser.get(steady)?.score).toBeCloseTo(0.6, 2);
    expect(byUser.get(steady)?.multiplier).toBeCloseTo(2, 1);
    // Too few requests: the 0.5 prior; one counted reporter of a cap of 3.
    expect(byUser.get(reported)?.components).toMatchObject({ age: 1, acceptRate: 0.5, reports: 1 / 3 });
    expect(byUser.get(reported)?.score).toBeCloseTo(0.25 + 0.25 + 0.15 - 0.2 / 3, 5);
    // Every member gets a score, unverified ones too.
    expect(await database.sql`select 1 from trust_scores where user_id = ${unverified}`).toHaveLength(1);
  });
});
