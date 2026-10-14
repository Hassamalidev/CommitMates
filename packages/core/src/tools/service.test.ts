import { NotFoundError, RateLimitError, ValidationError, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { PRIORITY, clearHandlers, registerHandler, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  cacheKeyFor,
  clearTools,
  dayBucket,
  getTool,
  hashParams,
  hourBucket,
  loadToolResult,
  recordToolSession,
  registerTool,
  registeredToolSlugs,
  startToolRun,
  storeToolResult,
  type ToolDefinition,
} from './service';

const NOW = new Date('2026-10-14T12:34:56.000Z');
const HOUR = 60 * 60 * 1000;

// A tool that exists only in this test: it echoes its input after reporting two steps.
const echoInput = z.object({ login: z.string().min(2, 'Enter at least 2 characters.'), mode: z.enum(['a', 'b']).optional() });
type EchoInput = z.infer<typeof echoInput>;

const echoTool: ToolDefinition<EchoInput> = {
  slug: 'echo',
  jobType: 'echo_test',
  cacheKind: 'echo',
  input: echoInput,
  subjectKey: (input) => input.login.toLowerCase(),
  params: (input) => ({ mode: input.mode }),
  idempotencyKey: (input, now) => `echo:${input.login.toLowerCase()}:${input.mode ?? '-'}:${hourBucket(now)}`,
  ttlSetting: 'cache.devCardTtlHours',
};

let database: TestDatabase;
/** Logins whose first run must wait on a rate limit. */
const slowLogins = new Set<string>();

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(async () => {
  await database.sql`truncate jobs, analysis_cache, tool_sessions cascade`;
  clearTools();
  clearHandlers();
  slowLogins.clear();
  registerTool(echoTool);
  registerHandler<EchoInput>({
    type: 'echo_test',
    schema: echoInput,
    priority: PRIORITY.INTERACTIVE,
    async run(payload, ctx) {
      await ctx.progress({ step: 'finding', pct: 25, message: `Finding @${payload.login}` });
      if (payload.login === 'ghost') throw new NotFoundError('echo.not_found', "We couldn't find @ghost on GitHub. Check the spelling?");
      if (slowLogins.delete(payload.login)) throw new RateLimitError(new Date(Date.now() + HOUR));
      await ctx.progress({ step: 'building', pct: 75 });
      const resultRef = await storeToolResult(echoTool, payload, { echoed: payload.login }, { isMemberSubject: false, now: ctx.now() });
      return { kind: 'done', resultRef };
    },
  });
});

async function collect(jobId: string): Promise<JobEvent[]> {
  const events: JobEvent[] = [];
  for await (const event of watchJob(jobId, { sleep: () => Promise.resolve() })) {
    events.push(event);
    if (event.event === 'waiting') break;
  }
  return events;
}

describe('buckets and hashes', () => {
  it('buckets by UTC hour and day', () => {
    expect(hourBucket(NOW)).toBe('2026-10-14T12');
    expect(dayBucket(NOW)).toBe('2026-10-14');
  });

  it('hashes parameters independently of key order and ignores undefined', () => {
    expect(hashParams(undefined)).toBe('default');
    expect(hashParams({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(hashParams({ b: [{ x: 1, y: 2 }], a: 1, c: undefined }));
    expect(hashParams({ a: 1 })).not.toBe(hashParams({ a: 2 }));
    expect(hashParams({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives the cache key from subject and parameters', () => {
    expect(cacheKeyFor(echoTool, { login: 'Someone' })).toEqual({
      kind: 'echo',
      subjectKey: 'someone',
      paramsHash: hashParams({ mode: undefined }),
    });
    expect(cacheKeyFor(echoTool, { login: 'someone', mode: 'a' }).paramsHash).not.toBe(
      cacheKeyFor(echoTool, { login: 'someone', mode: 'b' }).paramsHash,
    );
  });
});

describe('registry', () => {
  it('finds tools by slug', () => {
    expect(registeredToolSlugs()).toEqual(['echo']);
    expect(getTool('echo')?.jobType).toBe('echo_test');
    expect(getTool('nope')).toBeUndefined();
  });
});

describe('startToolRun', () => {
  it('rejects an unknown tool and invalid input with the field name', async () => {
    await expect(startToolRun('nope', {})).rejects.toBeInstanceOf(NotFoundError);
    const error = await startToolRun('echo', { login: 'x' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: 'login', userMessage: 'Enter at least 2 characters.' });
    expect(await database.sql`select 1 from jobs`).toHaveLength(0);
  });

  it('queues one interactive job per idempotency bucket', async () => {
    const first = await startToolRun('echo', { login: 'Someone' }, { now: NOW });
    const again = await startToolRun('echo', { login: 'someone' }, { now: new Date(NOW.getTime() + 60_000) });
    const nextHour = await startToolRun('echo', { login: 'someone' }, { now: new Date(NOW.getTime() + HOUR) });
    expect(first.status).toBe('queued');
    expect(again).toEqual(first);
    expect(nextHour).not.toEqual(first);
    const rows = await database.sql`select type, priority, payload from jobs order by created_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'echo_test', priority: PRIORITY.INTERACTIVE, payload: { login: 'Someone' } });
  });

  it('runs end to end: progress, done, then answers from the cache', async () => {
    const run = await startToolRun('echo', { login: 'someone' });
    if (run.status !== 'queued') throw new Error('expected a queued run');
    const first = await watchJob(run.jobId, { sleep: () => Promise.resolve() }).next();
    expect(first.value).toEqual({ event: 'progress', data: { status: 'queued', progress: null } });

    await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
    const events = await collect(run.jobId);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(await loadToolResult(done?.event === 'done' ? done.data.resultRef : null)).toEqual({ echoed: 'someone' });

    const cached = await startToolRun('echo', { login: 'SOMEONE' });
    expect(cached).toMatchObject({ status: 'done', result: { echoed: 'someone' } });
    // Different parameters are a different result.
    expect((await startToolRun('echo', { login: 'someone', mode: 'b' })).status).toBe('queued');
  });

  it('shows a wait on a rate limit, then finishes when the limit lifts', async () => {
    slowLogins.add('patient');
    const run = await startToolRun('echo', { login: 'patient' });
    if (run.status !== 'queued') throw new Error('expected a queued run');

    await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
    const waiting = (await collect(run.jobId)).at(-1);
    expect(waiting).toMatchObject({ event: 'waiting', data: { progress: { step: 'finding', pct: 25 } } });

    await database.sql`update jobs set run_at = now() where id = ${run.jobId}`;
    await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
    expect((await collect(run.jobId)).at(-1)?.event).toBe('done');
    const [job] = await database.sql`select attempts from jobs where id = ${run.jobId}`;
    // Waiting did not consume an attempt.
    expect(job!.attempts).toBe(1);
  });

  it('reports a failure with the friendly message', async () => {
    const run = await startToolRun('echo', { login: 'ghost' });
    if (run.status !== 'queued') throw new Error('expected a queued run');
    await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
    expect((await collect(run.jobId)).at(-1)).toEqual({
      event: 'error',
      data: { message: "We couldn't find @ghost on GitHub. Check the spelling?" },
    });
  });
});

describe('storeToolResult and loadToolResult', () => {
  it('keeps results about non-members no longer than the privacy TTL', async () => {
    await withSettings({ 'cache.devCardTtlHours': 48, 'privacy.nonUserRawTtlHours': 24 }, async () => {
      await storeToolResult(echoTool, { login: 'visitor' }, { v: 1 }, { isMemberSubject: false, now: NOW });
      await storeToolResult(echoTool, { login: 'member' }, { v: 2 }, { isMemberSubject: true, now: NOW });
    });
    const rows = await database.sql`select subject_key, is_member_subject, expires_at from analysis_cache order by subject_key`;
    expect(rows.map((row) => [row.subject_key, row.is_member_subject, (row.expires_at.getTime() - NOW.getTime()) / HOUR])).toEqual([
      ['member', true, 48],
      ['visitor', false, 24],
    ]);
  });

  it('replaces an earlier result and stops answering once it expires', async () => {
    await storeToolResult(echoTool, { login: 'someone' }, { v: 1 }, { isMemberSubject: false, now: NOW });
    const ref = await storeToolResult(echoTool, { login: 'someone' }, { v: 2 }, { isMemberSubject: false, now: NOW });
    expect(await database.sql`select 1 from analysis_cache`).toHaveLength(1);
    expect(await loadToolResult(ref, NOW)).toEqual({ v: 2 });
    expect(await loadToolResult(ref, new Date(NOW.getTime() + 13 * HOUR))).toBeNull();
    expect(await loadToolResult({ something: 'else' }, NOW)).toBeNull();
    expect(await loadToolResult(undefined, NOW)).toBeNull();
  });
});

describe('recordToolSession', () => {
  it('stores the tool and the hashed IP, with or without a member', async () => {
    await recordToolSession({ tool: 'echo', ipHashDay: 'abc123' });
    const rows = await database.sql`select tool, ip_hash_day, user_id from tool_sessions`;
    expect(rows).toEqual([{ tool: 'echo', ip_hash_day: 'abc123', user_id: null }]);
  });
});
