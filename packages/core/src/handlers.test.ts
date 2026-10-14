import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { clearHandlers, enqueue, registeredJobTypes, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobHandlers, registerAllHandlers } from './handlers';

let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('registerAllHandlers', () => {
  it('registers every handler once and tolerates repeat calls', () => {
    clearHandlers();
    registerAllHandlers();
    registerAllHandlers();
    expect(registeredJobTypes().sort()).toEqual(jobHandlers.map((handler) => handler.type).sort());
    expect(new Set(registeredJobTypes()).size).toBe(jobHandlers.length);
  });

  it('gives every job type a schedule-free, snake_case name', () => {
    for (const handler of jobHandlers) expect(handler.type).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe('recompute_settings job', () => {
  it('runs through the queue and reports what it did', async () => {
    registerAllHandlers();
    const job = await enqueue('recompute_settings', {});
    const report = await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    expect(report.done).toBe(1);
    const [row] = await database.sql`select status, result_ref from jobs where id = ${job.id}`;
    // Without samples every registered key reports "no data yet" and keeps its default.
    expect(row).toMatchObject({ status: 'done', result_ref: { updated: [], failed: [] } });
    expect((row?.result_ref as { empty: string[] }).empty).toContain('persona.nightOwl.share');
  });

  it('source syncs are scheduled weekly by migrations', async () => {
    const rows = await database.sql`
      select name, job_type from job_schedules where name in ('sync-linguist', 'sync-explore') order by name`;
    expect(rows).toEqual([
      { name: 'sync-explore', job_type: 'sync_explore' },
      { name: 'sync-linguist', job_type: 'sync_linguist' },
    ]);
  });

  it('is scheduled nightly by a migration', async () => {
    const [row] = await database.sql`select cron_expr, job_type, enabled from job_schedules where name = 'recompute-settings'`;
    expect(row).toMatchObject({ job_type: 'recompute_settings', enabled: true });
  });
});
