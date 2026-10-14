import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getToolMetrics, recordSignUpConversion } from './service';

const NOW = new Date('2026-10-14T12:00:00Z'); // a Wednesday
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

let database: TestDatabase;

async function session(tool: string, ipHash: string, at: Date, userId: string | null = null): Promise<void> {
  await database.sql`insert into tool_sessions (tool, ip_hash_day, user_id, created_at) values (${tool}, ${ipHash}, ${userId}, ${at})`;
}

beforeAll(async () => {
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(async () => {
  await database.sql`truncate tool_sessions, fairness_reports`;
});

describe('recordSignUpConversion', () => {
  it("credits the past day's anonymous runs from the same hashed address only", async () => {
    const member = await insertTestUser(database.sql);
    const other = await insertTestUser(database.sql);
    await session('dev-card', 'same', hoursAgo(2));
    await session('compat', 'same', hoursAgo(20));
    await session('dev-card', 'same', hoursAgo(30)); // outside the 24-hour window
    await session('dev-card', 'elsewhere', hoursAgo(1)); // another address
    await session('dev-card', 'same', hoursAgo(1), other); // a signed-in run is not a conversion candidate

    expect(await recordSignUpConversion(member, 'same', NOW)).toBe(2);
    // A second sign-in finds nothing left to credit.
    expect(await recordSignUpConversion(member, 'same', NOW)).toBe(0);
    const converted = await database.sql`select tool from tool_sessions where converted_user_id = ${member} order by tool`;
    expect(converted.map((row) => row.tool)).toEqual(['compat', 'dev-card']);
  });
});

describe('getToolMetrics', () => {
  it('counts runs per tool, the conversion rate and fairness reports per week', async () => {
    const member = await insertTestUser(database.sql);
    await session('dev-card', 'a', hoursAgo(3)); // too recent for the conversion rate
    await session('dev-card', 'b', hoursAgo(3 * 24), null);
    await session('dev-card', 'c', hoursAgo(10 * 24));
    await session('fairness', 'd', hoursAgo(5 * 24));
    await session('fairness', 'e', hoursAgo(40 * 24)); // outside every window
    await database.sql`update tool_sessions set converted_user_id = ${member} where ip_hash_day = 'b'`;

    for (const at of [hoursAgo(1), hoursAgo(2), hoursAgo(9 * 24)]) {
      await database.sql`insert into fairness_reports (repo_github_id, params, result, computed_at) values (1, '{}', '{}', ${at})`;
    }

    const metrics = await getToolMetrics(NOW);
    expect(metrics.usage).toEqual([
      { tool: 'dev-card', recent: 2, total: 3 },
      { tool: 'fairness', recent: 1, total: 1 },
    ]);
    // Anonymous runs between 30 days and 1 day old: b (converted), c, d.
    expect(metrics.conversion).toEqual({ sessions: 3, converted: 1, rate: 1 / 3 });
    expect(metrics.fairnessWeekly).toEqual([
      { weekStart: '2026-10-05', count: 1 },
      { weekStart: '2026-10-12', count: 2 },
    ]);
  });

  it('has no rate before any run has had a day to convert', async () => {
    await session('dev-card', 'a', hoursAgo(1));
    expect((await getToolMetrics(NOW)).conversion).toEqual({ sessions: 0, converted: 0, rate: null });
  });
});
