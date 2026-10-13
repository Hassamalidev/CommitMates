import { getDb, getSetting, schema, type DbOrTx } from '@commitmates/db';
import { eq } from 'drizzle-orm';

import { getHandler } from './registry';
import type { Job, JobProgress } from './types';

export type EnqueueOptions = {
  /** A second enqueue with the same key returns the first job instead of creating one. */
  idempotencyKey?: string;
  priority?: number;
  runAt?: Date;
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

  const [created] = await db
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
    })
    .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
    .returning();
  if (created) return created;

  // The key already exists: hand back the job that owns it.
  const key = options.idempotencyKey;
  if (key === undefined) throw new Error('enqueue: insert returned no row without an idempotency key');
  const [existing] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key));
  if (!existing) throw new Error(`enqueue: job with idempotency key "${key}" vanished`);
  return existing;
}
