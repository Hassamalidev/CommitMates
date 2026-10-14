import {
  ExternalServiceError,
  NotFoundError,
  RateLimitError,
  createDb,
  setLogger,
  type DbHandle,
} from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PRIORITY,
  clearHandlers,
  enqueue,
  evaluateSchedules,
  getJobView,
  nextCronRun,
  registerHandler,
  runTick,
  toJobEvent,
  upsertSchedule,
  watchJob,
  type JobEvent,
  type JobHandler,
  type JobOutcome,
} from './index';

let database: TestDatabase;
const BUDGET_MS = 30_000;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  clearHandlers();
  await database.sql`delete from jobs`;
  await database.sql`delete from job_schedules`;
});

const payloadSchema = z.object({ n: z.number().int() });
type Payload = z.infer<typeof payloadSchema>;

function handler(
  type: string,
  run: JobHandler<Payload>['run'],
  extra: Partial<JobHandler<Payload>> = {},
): JobHandler<Payload> {
  const definition: JobHandler<Payload> = { type, schema: payloadSchema, priority: PRIORITY.USER_BG, run, ...extra };
  registerHandler(definition);
  return definition;
}

const jobRow = async (id: string) => {
  const [row] = await database.sql`select * from jobs where id = ${id}`;
  return row!;
};

describe('enqueue', () => {
  it('uses the handler priority and the default attempts', async () => {
    handler('sample', () => Promise.resolve({ kind: 'done' }));
    const job = await enqueue('sample', { n: 1 });
    expect(job).toMatchObject({ status: 'queued', priority: PRIORITY.USER_BG, maxAttempts: 5, attempts: 0 });
  });

  it('returns the existing job for a repeated idempotency key', async () => {
    const first = await enqueue('sample', { n: 1 }, { idempotencyKey: 'sample:1' });
    const second = await enqueue('sample', { n: 2 }, { idempotencyKey: 'sample:1' });
    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual({ n: 1 });
    const rows = await database.sql`select 1 from jobs`;
    expect(rows).toHaveLength(1);
  });
});

describe('runTick outcomes', () => {
  it('marks a job done and stores its result reference', async () => {
    handler('ok', async (payload, ctx) => {
      await ctx.progress({ step: 'working', pct: 50 });
      return { kind: 'done', resultRef: { kind: 'sample', value: payload.n * 2 } };
    });
    const job = await enqueue('ok', { n: 21 });
    const report = await runTick({ budgetMs: BUDGET_MS });

    expect(report).toMatchObject({ claimed: 1, done: 1 });
    expect(await jobRow(job.id)).toMatchObject({
      status: 'done',
      attempts: 1,
      locked_at: null,
      locked_by: null,
      result_ref: { kind: 'sample', value: 42 },
      progress: { step: 'working', pct: 50 },
    });
  });

  it('continues in a child job with the progress copied forward', async () => {
    handler('pages', async (payload, ctx): Promise<JobOutcome> => {
      await ctx.progress({ step: `page ${payload.n}` });
      return payload.n < 3 ? { kind: 'continue', payload: { n: payload.n + 1 } } : { kind: 'done', resultRef: payload.n };
    });
    const root = await enqueue('pages', { n: 1 }, { priority: PRIORITY.INTERACTIVE });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report).toMatchObject({ continued: 2, done: 1 });

    const chain = await database.sql`select id, parent_id, status, payload, priority from jobs order by created_at`;
    expect(chain).toHaveLength(3);
    expect(chain[1]).toMatchObject({ parent_id: root.id, status: 'done', priority: PRIORITY.INTERACTIVE });
    expect(chain[2]).toMatchObject({ parent_id: chain[1]!.id, status: 'done', payload: { n: 3 } });

    const view = await getJobView(root.id);
    expect(view).toMatchObject({ rootId: root.id, currentId: chain[2]!.id, status: 'done', resultRef: 3 });
  });

  it('delays a continuation when asked', async () => {
    handler('later', () => Promise.resolve({ kind: 'continue', payload: { n: 2 }, delayMs: 60_000 }));
    await enqueue('later', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report).toMatchObject({ continued: 1, claimed: 1 });
    const [child] = await database.sql`select run_at from jobs where parent_id is not null`;
    expect(child!.run_at.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('waits without consuming an attempt', async () => {
    const until = new Date(Date.now() + 120_000);
    handler('waiter', () => Promise.resolve({ kind: 'wait', until, reason: 'dependency' }));
    const job = await enqueue('waiter', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });

    expect(report.waiting).toBe(1);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0, locked_at: null });
    expect(row.run_at.getTime()).toBe(until.getTime());
  });
});

describe('runTick errors', () => {
  it('retries retryable errors with exponential backoff and jitter', async () => {
    handler('flaky', () => Promise.reject(new ExternalServiceError('upstream.down', 'GitHub is having trouble.')));
    const job = await enqueue('flaky', { n: 1 });
    const now = new Date('2026-10-14T10:00:00.000Z');

    await runTick({ budgetMs: BUDGET_MS, now: () => now, random: () => 0.5 });
    let row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 1 });
    expect(row.last_error).toContain('upstream.down');
    // base 30s × 2^0 × jitter 1.0
    expect(row.run_at.getTime() - now.getTime()).toBe(30_000);

    await database.sql`update jobs set run_at = now() - interval '1 second' where id = ${job.id}`;
    await runTick({ budgetMs: BUDGET_MS, now: () => now, random: () => 0 });
    row = await jobRow(job.id);
    // base 30s × 2^1 × jitter 0.8
    expect(row.run_at.getTime() - now.getTime()).toBe(48_000);
    expect(row.attempts).toBe(2);
  });

  it('retries unexpected errors too', async () => {
    handler('buggy', () => Promise.reject(new TypeError('boom')));
    const job = await enqueue('buggy', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report.retried).toBe(1);
    expect((await jobRow(job.id)).last_error).toBe('TypeError: boom');
  });

  it('kills a job after its last attempt', async () => {
    handler('doomed', () => Promise.reject(new Error('still broken')), { maxAttempts: 2 });
    const job = await enqueue('doomed', { n: 1 });

    await runTick({ budgetMs: BUDGET_MS });
    await database.sql`update jobs set run_at = now() - interval '1 second' where id = ${job.id}`;
    const report = await runTick({ budgetMs: BUDGET_MS });

    expect(report.dead).toBe(1);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'dead',
      attempts: 2,
      user_message: 'Something broke on our side. We have logged it.',
    });
  });

  it('fails non-retryable errors immediately with a friendly message', async () => {
    handler('missing', () => Promise.reject(new NotFoundError('github.user_not_found', 'We could not find @nobody on GitHub.')));
    const job = await enqueue('missing', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });

    expect(report.failed).toBe(1);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      user_message: 'We could not find @nobody on GitHub.',
    });
  });

  it('treats an upstream rate limit as a wait until the reset', async () => {
    const resetAt = new Date(Date.now() + 180_000);
    handler('limited', () => Promise.reject(new RateLimitError(resetAt)));
    const job = await enqueue('limited', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });

    expect(report.waiting).toBe(1);
    const row = await jobRow(job.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0 });
    expect(row.run_at.getTime()).toBe(resetAt.getTime() + 5000);
  });

  it('kills a job whose payload does not parse', async () => {
    handler('strict', () => Promise.resolve({ kind: 'done' }));
    const job = await enqueue('strict', { n: 'not a number' });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report.dead).toBe(1);
    expect((await jobRow(job.id)).last_error).toContain('Invalid payload');
  });

  it('kills a job that has no handler', async () => {
    const job = await enqueue('orphan', { n: 1 });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report.dead).toBe(1);
    expect((await jobRow(job.id)).last_error).toContain('No handler');
  });
});

describe('runTick scheduling', () => {
  it('runs higher priorities first, then older jobs', async () => {
    const order: number[] = [];
    handler('ordered', (payload) => {
      order.push(payload.n);
      return Promise.resolve({ kind: 'done' });
    });
    await enqueue('ordered', { n: 1 }, { priority: PRIORITY.CRAWL });
    await enqueue('ordered', { n: 2 }, { priority: PRIORITY.INTERACTIVE, runAt: new Date(Date.now() - 1000) });
    await enqueue('ordered', { n: 3 }, { priority: PRIORITY.INTERACTIVE, runAt: new Date(Date.now() - 5000) });
    await enqueue('ordered', { n: 4 }, { priority: PRIORITY.MAINTENANCE });

    await withSettings({ 'jobs.claimBatchSize': 1 }, () => runTick({ budgetMs: BUDGET_MS }));
    expect(order).toEqual([3, 2, 4, 1]);
  });

  it('leaves future jobs alone', async () => {
    handler('future', () => Promise.resolve({ kind: 'done' }));
    await enqueue('future', { n: 1 }, { runAt: new Date(Date.now() + 60_000) });
    expect((await runTick({ budgetMs: BUDGET_MS })).claimed).toBe(0);
  });

  it('runs only the requested job when onlyJobId is set', async () => {
    handler('targeted', () => Promise.resolve({ kind: 'done' }));
    const target = await enqueue('targeted', { n: 1 });
    const other = await enqueue('targeted', { n: 2 }, { priority: PRIORITY.INTERACTIVE });

    const report = await runTick({ budgetMs: BUDGET_MS, onlyJobId: target.id });
    expect(report).toMatchObject({ claimed: 1, done: 1, scheduled: 0 });
    expect((await jobRow(other.id)).status).toBe('queued');
  });

  it('stops claiming when the remaining budget is too small', async () => {
    handler('budgeted', () => Promise.resolve({ kind: 'done' }));
    await enqueue('budgeted', { n: 1 });
    // The default minimum remaining budget is 5 s.
    const report = await runTick({ budgetMs: 1000 });
    expect(report.claimed).toBe(0);
  });

  it('reaps stale locks and kills reaped jobs that are out of attempts', async () => {
    handler('stuck', () => Promise.resolve({ kind: 'done' }));
    const retryable = await enqueue('stuck', { n: 1 });
    const exhausted = await enqueue('stuck', { n: 2 }, { maxAttempts: 1 });
    const fresh = await enqueue('stuck', { n: 3 });
    await database.sql`update jobs set status = 'running', attempts = 1, locked_by = 'gone',
                         locked_at = now() - interval '10 minutes' where id in (${retryable.id}, ${exhausted.id})`;
    await database.sql`update jobs set status = 'running', attempts = 1, locked_by = 'alive', locked_at = now()
                       where id = ${fresh.id}`;

    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report.reaped).toBe(2);
    expect((await jobRow(retryable.id)).status).toBe('done');
    expect((await jobRow(exhausted.id)).status).toBe('dead');
    expect(await jobRow(fresh.id)).toMatchObject({ status: 'running', locked_by: 'alive' });
  });

  it('never processes a job twice with two workers', async () => {
    const runs = new Map<number, number>();
    // A worker runs its claimed jobs one after another, so two jobs running at once are on
    // different workers. The first job waits for that overlap, so both workers take part
    // however fast or slow the machine is, instead of one draining the queue alone.
    let active = 0;
    let releaseFirst: (() => void) | undefined;
    const overlap = new Promise<undefined>((resolve) => {
      releaseFirst = () => {
        resolve(undefined);
      };
    });
    let first = true;
    handler('contended', async (payload) => {
      runs.set(payload.n, (runs.get(payload.n) ?? 0) + 1);
      active += 1;
      if (active > 1) releaseFirst?.();
      if (first) {
        first = false;
        await Promise.race([overlap, new Promise((resolve) => setTimeout(resolve, BUDGET_MS / 2))]);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      active -= 1;
      return { kind: 'done' };
    });
    const total = 40;
    for (let n = 0; n < total; n += 1) await enqueue('contended', { n });

    // Each worker gets its own connection pool, as two processes would.
    const pools: DbHandle[] = [createDb(database.url), createDb(database.url)];
    try {
      const reports = await Promise.all(
        pools.map((pool, index) => runTick({ budgetMs: BUDGET_MS, db: pool.db, workerId: `worker-${index}` })),
      );
      expect(reports[0]!.done + reports[1]!.done).toBe(total);
      expect(reports.every((report) => report.done > 0)).toBe(true);
    } finally {
      await Promise.all(pools.map((pool) => pool.close()));
    }

    expect(runs.size).toBe(total);
    expect([...runs.values()].every((count) => count === 1)).toBe(true);
    const [row] = await database.sql<{ count: number }[]>`
      select count(*)::int as count from jobs where status = 'done' and attempts = 1`;
    expect(row!.count).toBe(total);
  });
});

describe('schedules', () => {
  it('computes the next cron run in UTC', () => {
    const after = new Date('2026-10-14T10:30:00.000Z');
    expect(nextCronRun('0 3 * * *', after).toISOString()).toBe('2026-10-15T03:00:00.000Z');
    expect(nextCronRun('* * * * *', after).toISOString()).toBe('2026-10-14T10:31:00.000Z');
    expect(nextCronRun('0 0 * * 1', after).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('enqueues a due schedule once and advances it', async () => {
    handler('nightly', () => Promise.resolve({ kind: 'done' }), { priority: PRIORITY.MAINTENANCE });
    const due = new Date('2026-10-14T03:00:00.000Z');
    const now = new Date('2026-10-14T03:00:20.000Z');
    await upsertSchedule({ name: 'nightly', cronExpr: '0 3 * * *', jobType: 'nightly', payload: { n: 1 }, nextRunAt: due });

    expect(await evaluateSchedules(now)).toBe(1);
    expect(await evaluateSchedules(now)).toBe(0);

    const queued = await database.sql`select idempotency_key, priority, payload from jobs`;
    expect(queued).toEqual([
      expect.objectContaining({
        idempotency_key: 'schedule:nightly:2026-10-14T03:00:00.000Z',
        priority: PRIORITY.MAINTENANCE,
        payload: { n: 1 },
      }),
    ]);
    const [schedule] = await database.sql`select next_run_at, last_run_at from job_schedules where name = 'nightly'`;
    expect(schedule!.next_run_at.toISOString()).toBe('2026-10-15T03:00:00.000Z');
    expect(schedule!.last_run_at.toISOString()).toBe(now.toISOString());
  });

  it('skips disabled schedules and disables one with a bad expression', async () => {
    const past = new Date(Date.now() - 60_000);
    await upsertSchedule({ name: 'off', cronExpr: '* * * * *', jobType: 'nightly', nextRunAt: past });
    await database.sql`update job_schedules set enabled = false where name = 'off'`;
    await database.sql`insert into job_schedules (name, cron_expr, job_type, next_run_at)
                       values ('broken', 'not a cron', 'nightly', ${past})`;

    expect(await evaluateSchedules(new Date())).toBe(0);
    const [broken] = await database.sql`select enabled from job_schedules where name = 'broken'`;
    expect(broken!.enabled).toBe(false);
  });

  it('is evaluated by a normal tick', async () => {
    handler('ticked', () => Promise.resolve({ kind: 'done' }));
    await upsertSchedule({
      name: 'ticked',
      cronExpr: '* * * * *',
      jobType: 'ticked',
      payload: { n: 1 },
      nextRunAt: new Date(Date.now() - 1000),
    });
    const report = await runTick({ budgetMs: BUDGET_MS });
    expect(report).toMatchObject({ scheduled: 1, done: 1 });
  });
});

describe('watchJob', () => {
  const collect = async (jobId: string, onPoll?: (poll: number) => Promise<void>) => {
    const events: JobEvent[] = [];
    let poll = 0;
    const sleep = async () => {
      poll += 1;
      await onPoll?.(poll);
    };
    for await (const event of watchJob(jobId, { sleep })) events.push(event);
    return events;
  };

  it('streams progress, follows continuations and ends with done', async () => {
    handler('streamed', async (payload, ctx): Promise<JobOutcome> => {
      await ctx.progress({ step: `step ${payload.n}`, pct: payload.n * 50 });
      return payload.n < 2 ? { kind: 'continue', payload: { n: 2 } } : { kind: 'done', resultRef: { ok: true } };
    });
    const job = await enqueue('streamed', { n: 1 });

    const events = await collect(job.id, async (poll) => {
      if (poll === 1) await runTick({ budgetMs: BUDGET_MS });
    });
    expect(events).toEqual([
      { event: 'progress', data: { status: 'queued', progress: null } },
      { event: 'done', data: { resultRef: { ok: true } } },
    ]);
  });

  it('reports a waiting job with its resume time, then the failure message', async () => {
    const until = new Date(Date.now() + 90_000);
    let attempt = 0;
    handler('blocked', (): Promise<JobOutcome> => {
      attempt += 1;
      if (attempt === 1) return Promise.resolve({ kind: 'wait', until, reason: 'rate_limit' });
      return Promise.reject(new NotFoundError('gone', 'That repository no longer exists.'));
    });
    const job = await enqueue('blocked', { n: 1 });
    await runTick({ budgetMs: BUDGET_MS });

    const events = await collect(job.id, async (poll) => {
      if (poll === 1) {
        await database.sql`update jobs set run_at = now() - interval '1 second' where id = ${job.id}`;
        await runTick({ budgetMs: BUDGET_MS });
      }
    });
    expect(events).toEqual([
      { event: 'waiting', data: { until: until.toISOString(), progress: null } },
      { event: 'error', data: { message: 'That repository no longer exists.' } },
    ]);
  });

  it('ends with timeout after the connection lifetime', async () => {
    const job = await enqueue('never-run', { n: 1 }, { runAt: new Date(Date.now() + 3_600_000) });
    const events = await withSettings({ 'jobs.sseMaxMs': 0 }, () => collect(job.id));
    expect(events.map((event) => event.event)).toEqual(['waiting', 'timeout']);
  });

  it('reports an unknown job', async () => {
    const events = await collect('00000000-0000-4000-8000-000000000000');
    expect(events).toEqual([
      { event: 'error', data: { message: 'We could not find that job. It may have expired.' } },
    ]);
  });

  it('maps cancelled jobs to an error event', () => {
    const view = {
      rootId: 'a',
      currentId: 'a',
      status: 'cancelled' as const,
      progress: null,
      resultRef: null,
      userMessage: null,
      runAt: new Date(),
    };
    expect(toJobEvent(view, new Date())).toEqual({ event: 'error', data: { message: 'This job was cancelled.' } });
  });
});
