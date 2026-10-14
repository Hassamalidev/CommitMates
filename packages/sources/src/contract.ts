import type { Db, Logger } from '@commitmates/db';

export type SourceContext = {
  db: Db;
  now: () => Date;
  log: Logger;
  /** Epoch ms the fetch must finish by; sources that page through many requests stop early. */
  deadline?: number | undefined;
};

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
  /** True when this run fetched only part of what changed; the job continues in a follow-up run. */
  hasMore?(raw: Raw): boolean;
  /** Set for incremental sources, where a run with nothing new is normal. */
  allowEmpty?: boolean;
  /** Items the source provides but we cannot use, e.g. patterns that do not compile. */
  countUnusable?(items: Normalized[]): number;
  sync(items: Normalized[], ctx: SourceContext): Promise<SyncCounts>;
}
