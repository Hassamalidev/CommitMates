import { randomUUID } from 'node:crypto';

import {
  AppError,
  ExternalServiceError,
  RateLimitError,
  RateLimitedError,
  getDb,
  getLogger,
  getSetting,
  schema,
  type Db,
  type Logger,
} from '@commitmates/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import { enqueue } from './enqueue';
import { getHandler } from './registry';
import { evaluateSchedules } from './schedules';
import type { Job, JobContext, JobOutcome, JobProgress } from './types';

const { jobs } = schema;

type JobUpdate = PgUpdateSetSource<typeof jobs>;

/** Margin added after an upstream rate limit resets, so the retry lands after the reset. */
const RATE_LIMIT_MARGIN_MS = 5000;
/** Backoff jitter range (CLAUDE.md §5.4): multiplies the delay by 0.8–1.2. */
const JITTER_MIN = 0.8;
const JITTER_SPREAD = 0.4;
/** Longest error text stored on a job row. */
const MAX_ERROR_CHARS = 2000;
const MS_PER_SECOND = 1000;

const GENERIC_FAILURE_MESSAGE = 'Something broke on our side. We have logged it.';

export type RunTickOptions = {
  /** Time budget for this tick, in milliseconds. */
  budgetMs: number;
  /** Run only this job (and its continuations): the interactive path after a tool request. */
  onlyJobId?: string;
  workerId?: string;
  now?: () => Date;
  /** Source of jitter in [0, 1); injectable for tests. */
  random?: () => number;
  db?: Db;
  log?: Logger;
};

export type TickReport = {
  reaped: number;
  scheduled: number;
  claimed: number;
  done: number;
  continued: number;
  waiting: number;
  retried: number;
  failed: number;
  dead: number;
};

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_CHARS);
}

/** Expected failures that a retry cannot fix (CLAUDE.md §5.4, runner rule 6). */
function isNonRetryable(error: unknown): error is AppError {
  if (!(error instanceof AppError)) return false;
  if (error instanceof ExternalServiceError || error instanceof RateLimitError || error instanceof RateLimitedError) {
    return false;
  }
  // Client-side statuses describe the request itself; server-side ones may pass on retry.
  return error.status < 500; // allowed-literal: first HTTP server-error status
}

/** Running jobs whose lock is stale go back to the queue, or die if they are out of attempts. */
async function reapStaleLocks(db: Db, staleLockMs: number): Promise<number> {
  const cutoff = sql`now() - make_interval(secs => ${staleLockMs / MS_PER_SECOND})`;
  const rows = await db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then 'dead'::job_status else 'queued'::job_status end`,
      lockedAt: null,
      lockedBy: null,
      lastError: 'Worker stopped responding while running this job',
      userMessage: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then ${GENERIC_FAILURE_MESSAGE} else ${jobs.userMessage} end`,
    })
    .where(and(eq(jobs.status, 'running'), sql`${jobs.lockedAt} < ${cutoff}`))
    .returning({ id: jobs.id });
  return rows.length;
}

async function claim(db: Db, workerId: string, limit: number, onlyJobId: string | null): Promise<Job[]> {
  const rows = await db.execute<{ id: string }>(sql`
    update jobs
    set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs
      where status = 'queued' and run_at <= now()
        and (${onlyJobId}::uuid is null or id = ${onlyJobId}::uuid)
      order by priority desc, run_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  if (rows.length === 0) return [];
  const claimed = await db
    .select()
    .from(jobs)
    .where(
      inArray(
        jobs.id,
        rows.map((row) => row.id),
      ),
    );
  return claimed.sort((a, b) => b.priority - a.priority || a.runAt.getTime() - b.runAt.getTime());
}

/** Puts a claimed job back untouched: the tick ran out of budget before starting it. */
async function release(db: Db, job: Job): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'queued', lockedAt: null, lockedBy: null, attempts: sql`greatest(${jobs.attempts} - 1, 0)` })
    .where(eq(jobs.id, job.id));
}

type RunResult = { report: keyof TickReport; childId?: string };

async function runJob(job: Job, options: Required<Pick<RunTickOptions, 'now' | 'random'>> & {
  db: Db;
  log: Logger;
  deadline: number;
}): Promise<RunResult> {
  const { db, now, deadline } = options;
  const log = options.log.child({ jobId: job.id, jobType: job.type });
  const finish = (values: JobUpdate) =>
    db
      .update(jobs)
      .set({ lockedAt: null, lockedBy: null, ...values })
      .where(eq(jobs.id, job.id));

  const handler = getHandler(job.type);
  if (!handler) {
    await finish({ status: 'dead', lastError: `No handler registered for "${job.type}"`, userMessage: GENERIC_FAILURE_MESSAGE });
    log.error('job has no handler');
    return { report: 'dead' };
  }

  const payload = handler.schema.safeParse(job.payload);
  if (!payload.success) {
    await finish({
      status: 'dead',
      lastError: `Invalid payload: ${payload.error.message}`.slice(0, MAX_ERROR_CHARS),
      userMessage: GENERIC_FAILURE_MESSAGE,
    });
    log.error({ issues: payload.error.issues.length }, 'job payload failed validation');
    return { report: 'dead' };
  }

  let latestProgress = job.progress as JobProgress | null;
  const ctx: JobContext = {
    deadline,
    now,
    log,
    settings: (key) => getSetting(key, db),
    job: { id: job.id, attempts: job.attempts, parentId: job.parentId },
    progress: async (progress) => {
      latestProgress = progress;
      await db.update(jobs).set({ progress }).where(eq(jobs.id, job.id));
    },
  };

  const startedAt = Date.now();
  let outcome: JobOutcome;
  try {
    outcome = await handler.run(payload.data, ctx);
  } catch (error) {
    return handleError(job, error, { ...options, log, finish });
  }
  const durationMs = Date.now() - startedAt;

  if (outcome.kind === 'done') {
    await finish({ status: 'done', resultRef: outcome.resultRef ?? null, lastError: null });
    log.info({ durationMs }, 'job done');
    return { report: 'done' };
  }

  if (outcome.kind === 'continue') {
    const child = await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({ status: 'done', lockedAt: null, lockedBy: null, lastError: null })
        .where(eq(jobs.id, job.id));
      return enqueue(job.type, outcome.payload, {
        parentId: job.id,
        priority: job.priority,
        maxAttempts: job.maxAttempts,
        progress: latestProgress,
        runAt: new Date(now().getTime() + (outcome.delayMs ?? 0)),
        db: tx,
      });
    });
    log.info({ durationMs, childId: child.id }, 'job continues in a child');
    return { report: 'continued', childId: child.id };
  }

  // Waiting does not consume an attempt.
  await finish({ status: 'queued', runAt: outcome.until, attempts: sql`greatest(${jobs.attempts} - 1, 0)` });
  log.info({ durationMs, until: outcome.until.toISOString(), reason: outcome.reason }, 'job waiting');
  return { report: 'waiting' };
}

async function handleError(
  job: Job,
  error: unknown,
  options: {
    db: Db;
    log: Logger;
    now: () => Date;
    random: () => number;
    finish: (values: JobUpdate) => Promise<unknown>;
  },
): Promise<RunResult> {
  const { db, log, now, random, finish } = options;
  const lastError = describeError(error);

  if (error instanceof RateLimitError) {
    const until = new Date(error.resetAt.getTime() + RATE_LIMIT_MARGIN_MS);
    await finish({ status: 'queued', runAt: until, attempts: sql`greatest(${jobs.attempts} - 1, 0)`, lastError });
    log.info({ until: until.toISOString() }, 'job waiting on an upstream rate limit');
    return { report: 'waiting' };
  }

  if (isNonRetryable(error)) {
    await finish({ status: 'failed', lastError, userMessage: error.userMessage });
    log.warn({ code: error.code }, 'job failed');
    return { report: 'failed' };
  }

  if (job.attempts >= job.maxAttempts) {
    await finish({
      status: 'dead',
      lastError,
      userMessage: error instanceof AppError ? error.userMessage : GENERIC_FAILURE_MESSAGE,
    });
    log.error({ err: error, attempts: job.attempts }, 'job is dead');
    return { report: 'dead' };
  }

  const backoffBaseMs = await getSetting('jobs.backoffBaseMs', db);
  const jitter = JITTER_MIN + random() * JITTER_SPREAD;
  const delayMs =
    error instanceof RateLimitedError
      ? error.retryAfterSeconds * MS_PER_SECOND
      : backoffBaseMs * 2 ** (job.attempts - 1) * jitter; // allowed-literal: exponential backoff doubles
  await finish({ status: 'queued', runAt: new Date(now().getTime() + delayMs), lastError });
  log.warn({ err: error, attempts: job.attempts, delayMs: Math.round(delayMs) }, 'job will be retried');
  return { report: 'retried' };
}

/**
 * One run of the job runner within a time budget (CLAUDE.md §5.4): reap stale locks,
 * enqueue due schedules, then claim and run jobs until the budget is nearly spent.
 */
export async function runTick(options: RunTickOptions): Promise<TickReport> {
  const db = options.db ?? getDb();
  const log = options.log ?? getLogger();
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const deadline = Date.now() + options.budgetMs;

  const report: TickReport = {
    reaped: 0,
    scheduled: 0,
    claimed: 0,
    done: 0,
    continued: 0,
    waiting: 0,
    retried: 0,
    failed: 0,
    dead: 0,
  };

  const [staleLockMs, minRemainingMs, claimBatchSize] = await Promise.all([
    getSetting('jobs.staleLockMs', db),
    getSetting('jobs.minRemainingMs', db),
    getSetting('jobs.claimBatchSize', db),
  ]);
  const hasBudget = () => deadline - Date.now() > minRemainingMs;

  report.reaped = await reapStaleLocks(db, staleLockMs);

  let onlyJobId = options.onlyJobId ?? null;
  if (onlyJobId === null) report.scheduled = await evaluateSchedules(now(), db);

  while (hasBudget()) {
    const claimed = await claim(db, workerId, onlyJobId === null ? claimBatchSize : 1, onlyJobId);
    if (claimed.length === 0) break;
    report.claimed += claimed.length;

    let followId: string | undefined;
    for (const job of claimed) {
      if (!hasBudget()) {
        await release(db, job);
        report.claimed -= 1;
        continue;
      }
      const result = await runJob(job, { db, log, now, random, deadline });
      report[result.report] += 1;
      followId = result.childId;
    }

    if (onlyJobId !== null) {
      // Follow the continuation chain so an interactive job finishes without waiting for cron.
      if (followId === undefined) break;
      onlyJobId = followId;
    }
  }

  return report;
}
