import { createHash } from 'node:crypto';

import { ExternalServiceError, RateLimitError, getDb, getLogger, schema, type Db } from '@commitmates/db';
import { eq } from 'drizzle-orm';

import type { SourceContext, SourceModule, SyncCounts } from './contract';

const { sourceSnapshots } = schema;

/** Longest error text stored on a snapshot. */
const MAX_ERROR_CHARS = 1000;

export type SourceSyncResult =
  | { status: 'unchanged'; version: string }
  | ({ status: 'synced'; version: string; itemCount: number; unusable: number; more: boolean } & SyncCounts);

export type RunSourceOptions = { db?: Db; now?: () => Date; deadline?: number };

/**
 * Runs one source end to end and records the outcome in `source_snapshots`.
 * A failed fetch or parse leaves the existing rows untouched, stores `last_error`,
 * and rethrows as a retryable error: data is never wiped because a source is down.
 */
export async function runSourceSync<Raw, Normalized>(
  source: SourceModule<Raw, Normalized>,
  options: RunSourceOptions = {},
): Promise<SourceSyncResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const log = getLogger().child({ source: source.name });
  const ctx: SourceContext = { db, now, log, deadline: options.deadline };

  try {
    const { raw, version } = await source.fetchRaw(ctx);
    const [snapshot] = await db.select().from(sourceSnapshots).where(eq(sourceSnapshots.source, source.name));

    if (snapshot?.version === version && snapshot.lastError === null) {
      await db.update(sourceSnapshots).set({ fetchedAt: now() }).where(eq(sourceSnapshots.source, source.name));
      log.info({ version }, 'source unchanged');
      return { status: 'unchanged', version };
    }

    const items = source.normalize(raw);
    if (items.length === 0 && source.allowEmpty !== true) throw new Error('source returned no usable items');
    const more = source.hasMore?.(raw) ?? false;
    const unusable = source.countUnusable?.(items) ?? 0;
    const counts = await db.transaction((tx) => source.sync(items, { ...ctx, db: tx }));

    const values = {
      version,
      checksum: createHash('sha256').update(JSON.stringify(items)).digest('hex'),
      itemCount: items.length,
      skippedCount: unusable,
      fetchedAt: now(),
      lastError: null,
    };
    await db
      .insert(sourceSnapshots)
      .values({ source: source.name, ...values })
      .onConflictDoUpdate({ target: sourceSnapshots.source, set: values });

    log.info({ ...counts, unusable, itemCount: items.length }, 'source synced');
    return { status: 'synced', version, itemCount: items.length, unusable, more, ...counts };
  } catch (error) {
    // An exhausted GitHub budget is not a source failure: the job waits and tries again.
    if (error instanceof RateLimitError) throw error;
    const lastError = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
      0,
      MAX_ERROR_CHARS,
    );
    await db
      .insert(sourceSnapshots)
      .values({ source: source.name, lastError })
      .onConflictDoUpdate({ target: sourceSnapshots.source, set: { lastError } });
    log.warn({ err: error }, 'source sync failed; keeping the last good data');
    throw new ExternalServiceError('source.sync_failed', 'A data source is unavailable right now.', { cause: error });
  }
}
