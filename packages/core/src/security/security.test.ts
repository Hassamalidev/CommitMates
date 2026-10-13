import { RateLimitedError, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { guardRate } from './service';

let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('guardRate', () => {
  it('allows the configured capacity, then throws with a retry hint', async () => {
    await withSettings({ 'rate.tool.capacity': 2, 'rate.tool.refillPerMin': 4 }, async () => {
      await guardRate('tool:dev-card:ip:abc', 'rate.tool');
      await guardRate('tool:dev-card:ip:abc', 'rate.tool');
      const error = await guardRate('tool:dev-card:ip:abc', 'rate.tool').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RateLimitedError);
      expect(error).toMatchObject({ status: 429, retryAfterSeconds: 15 });
      expect((error as RateLimitedError).userMessage).toContain('about 15 seconds');

      // Another key has its own bucket.
      await expect(guardRate('tool:dev-card:ip:other', 'rate.tool')).resolves.toBeUndefined();
    });
  });

  it('uses separate settings per prefix', async () => {
    await withSettings({ 'rate.write.capacity': 1, 'rate.write.refillPerMin': 0 }, async () => {
      await guardRate('write:user-1', 'rate.write');
      await expect(guardRate('write:user-1', 'rate.write')).rejects.toMatchObject({ retryAfterSeconds: 60 });
    });
  });
});

describe('maintenance jobs', () => {
  it('cleanup_rate_buckets deletes day-old buckets', async () => {
    await database.sql`insert into rate_limit_buckets (key, tokens, updated_at)
                       values ('old', 1, now() - interval '3 days'), ('new', 1, now())`;
    const job = await enqueue('cleanup_rate_buckets', {});
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    const rows = await database.sql`select key from rate_limit_buckets where key in ('old', 'new')`;
    expect(rows.map((row) => row.key)).toEqual(['new']);
  });

  it('rotate_salts leaves exactly the current salts', async () => {
    await database.sql`insert into salts (kind, period, salt) values ('ip', 1, '\\x00'), ('aggregate', 1, '\\x00')`;
    const job = await enqueue('rotate_salts', {});
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    const rows = await database.sql`select kind, period from salts order by kind`;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.period > 1)).toBe(true);
  });

  it('both are scheduled daily', async () => {
    const rows = await database.sql`
      select name, job_type from job_schedules where name in ('cleanup-rate-buckets', 'rotate-salts') order by name`;
    expect(rows).toEqual([
      { name: 'cleanup-rate-buckets', job_type: 'cleanup_rate_buckets' },
      { name: 'rotate-salts', job_type: 'rotate_salts' },
    ]);
  });
});
