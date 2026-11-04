import { getDb, getSetting, schema, type DbOrTx } from '@commitmates/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { getHandler } from './registry';
import type { Job, JobProgress } from './types';

const MS_PER_SECOND = 1000;
/** Jobs that ended without a result; a new request with their key starts again instead of reusing the failure. */
const ENDED_UNSUCCESSFULLY = ['failed', 'dead', 'cancelled'] as const; // allowed-literal: schema enum values (§5.4 job_status)

export type EnqueueOptions = {
  /**
   * A second enqueue with the same key returns the first job instead of creating one, unless that
   * job failed, died or was cancelled: then its key is released and a fresh job starts.
   */
  idempotencyKey?: string;
  priority?: number;
  runAt?: Date;
  /**
   * Run this long after now, by the database's clock. Jobs are claimed with the database's
   * `now()`, so a time taken from the application's clock can land slightly in the future
   * and be skipped by the tick that created it.
   */
  delayMs?: number;
  maxAttempts?: number;
  parentId?: string;
  progress?: JobProgress | null;
  db?: DbOrTx;
};

/** Adds a job to the queue. Priority and attempts default to the registered handler's. */
export async function enqueue(type: string, payload: unknown, options: EnqueueOptions = {}): Promise<Job> {
  const db = options.db ?? getDb();
  const handler = getHandler(type);
  const maxAttempts =
    options.maxAttempts ?? handler?.maxAttempts ?? (await getSetting('jobs.maxAttempts.default', db));

  const insert = () =>
    db
      .insert(schema.jobs)
      .values({
        type,
        payload,
        priority: options.priority ?? handler?.priority ?? 0,
        maxAttempts,
        idempotencyKey: options.idempotencyKey ?? null,
        parentId: options.parentId ?? null,
        progress: options.progress ?? null,
        ...(options.runAt ? { runAt: options.runAt } : {}),
        ...(options.delayMs !== undefined && options.delayMs > 0
          ? { runAt: sql`now() + make_interval(secs => ${options.delayMs / MS_PER_SECOND})` }
          : {}),
      })
      .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
      .returning();

  const [created] = await insert();
  if (created) return created;

  // The key already exists: hand back the job that owns it.
  const key = options.idempotencyKey;
  if (key === undefined) throw new Error('enqueue: insert returned no row without an idempotency key');
  const [existing] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key));
  if (!existing) throw new Error(`enqueue: job with idempotency key "${key}" vanished`);
  if (!(ENDED_UNSUCCESSFULLY as readonly string[]).includes(existing.status)) return existing;

  // A failure is not a result to reuse: release the key (the old row stays for the admin pages) and
  // start again. Of concurrent requests only one insert wins the key; the others get that job.
  await db
    .update(schema.jobs)
    .set({ idempotencyKey: null })
    .where(and(eq(schema.jobs.id, existing.id), inArray(schema.jobs.status, [...ENDED_UNSUCCESSFULLY])));
  const [retried] = await insert();
  if (retried) return retried;
  const [winner] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key));
  if (!winner) throw new Error(`enqueue: job with idempotency key "${key}" vanished`);
  return winner;
}
