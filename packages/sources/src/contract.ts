import type { Db, Logger } from '@commitmates/db';

export type SourceContext = { db: Db; now: () => Date; log: Logger };

export type SyncCounts = { inserted: number; updated: number; deleted: number; skipped: number };

/**
 * One live data source (CLAUDE.md §5.7). `fetchRaw` talks to the network, `normalize`
 * is pure, and `sync` writes a diff. The runner records a snapshot and keeps the last
 * good data when anything fails.
 */
export interface SourceModule<Raw, Normalized> {
  name: string;
  /** `version` is an etag, sha or checksum of the upstream content. */
  fetchRaw(ctx: SourceContext): Promise<{ raw: Raw; version: string }>;
  normalize(raw: Raw): Normalized[];
  /** Items the source provides but we cannot use, e.g. patterns that do not compile. */
  countUnusable?(items: Normalized[]): number;
  sync(items: Normalized[], ctx: SourceContext): Promise<SyncCounts>;
}
