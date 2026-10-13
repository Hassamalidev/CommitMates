import { getDb, getSetting, type Db, type schema } from '@commitmates/db';
import { sql } from 'drizzle-orm';

import type { JobProgress } from './types';

export type JobView = {
  /** The job the client asked about. */
  rootId: string;
  /** The newest job in its continuation chain; its state is what the client sees. */
  currentId: string;
  status: (typeof schema.jobStatus.enumValues)[number];
  progress: JobProgress | null;
  resultRef: unknown;
  userMessage: string | null;
  runAt: Date;
};

export type JobEvent =
  | { event: 'progress'; data: { status: 'queued' | 'running'; progress: JobProgress | null } }
  | { event: 'waiting'; data: { until: string; progress: JobProgress | null } }
  | { event: 'done'; data: { resultRef: unknown } }
  | { event: 'error'; data: { message: string } }
  /** The connection lifetime is over; the client should reconnect. */
  | { event: 'timeout'; data: Record<string, never> };

type ChainRow = {
  id: string;
  status: JobView['status'];
  progress: JobProgress | null;
  result_ref: unknown;
  user_message: string | null;
  run_at: Date;
};

/** A queued job scheduled this far ahead is waiting on something, not merely next in line. */
const WAITING_THRESHOLD_MS = 2000;

/** Reads a job through its continuation chain (`parent_id`), returning the newest link. */
export async function getJobView(jobId: string, db: Db = getDb()): Promise<JobView | null> {
  const rows = await db.execute<ChainRow>(sql`
    with recursive chain as (
      select j.*, 0 as depth from jobs j where j.id = ${jobId}::uuid
      union all
      select child.*, chain.depth + 1 from jobs child join chain on child.parent_id = chain.id
    )
    select id, status, progress, result_ref, user_message, run_at
    from chain order by depth desc, created_at desc limit 1`);
  const row = rows[0];
  if (!row) return null;
  return {
    rootId: jobId,
    currentId: row.id,
    status: row.status,
    progress: row.progress,
    resultRef: row.result_ref,
    userMessage: row.user_message,
    runAt: new Date(row.run_at),
  };
}

export function toJobEvent(view: JobView, now: Date): JobEvent {
  switch (view.status) {
    case 'done':
      return { event: 'done', data: { resultRef: view.resultRef } };
    case 'failed':
    case 'dead':
    case 'cancelled':
      return { event: 'error', data: { message: view.userMessage ?? 'This job was cancelled.' } };
    case 'running':
      return { event: 'progress', data: { status: 'running', progress: view.progress } };
    case 'queued':
      return view.runAt.getTime() - now.getTime() > WAITING_THRESHOLD_MS
        ? { event: 'waiting', data: { until: view.runAt.toISOString(), progress: view.progress } }
        : { event: 'progress', data: { status: 'queued', progress: view.progress } };
  }
}

export type WatchOptions = {
  signal?: AbortSignal;
  db?: Db;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a job every `jobs.ssePollMs` and yields an event whenever its visible state
 * changes. Ends on `done` or `error`, or with `timeout` after `jobs.sseMaxMs`.
 */
export async function* watchJob(jobId: string, options: WatchOptions = {}): AsyncGenerator<JobEvent> {
  const db = options.db ?? getDb();
  const sleep = options.sleep ?? defaultSleep;
  const [pollMs, maxMs] = await Promise.all([getSetting('jobs.ssePollMs', db), getSetting('jobs.sseMaxMs', db)]);
  const startedAt = Date.now();
  let previous: string | undefined;

  while (!options.signal?.aborted) {
    const view = await getJobView(jobId, db);
    if (!view) {
      yield { event: 'error', data: { message: 'We could not find that job. It may have expired.' } };
      return;
    }
    const event = toJobEvent(view, new Date());
    const serialized = JSON.stringify(event);
    if (serialized !== previous) {
      previous = serialized;
      yield event;
    }
    if (event.event === 'done' || event.event === 'error') return;
    if (Date.now() - startedAt >= maxMs) {
      yield { event: 'timeout', data: {} };
      return;
    }
    await sleep(pollMs);
  }
}
