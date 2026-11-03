import { listSourceSnapshots } from '@commitmates/db';

/**
 * Every source the app syncs, by the name its snapshots carry (CLAUDE.md §6.11). The attribution
 * page must credit each one; a test keeps this list equal to the source modules in packages/sources.
 */
export const SYNCED_SOURCE_NAMES = ['linguist', 'explore', 'gitleaks', 'stopwords', 'hipo', 'disposable_emails'] as const;

export type SyncedSourceName = (typeof SYNCED_SOURCE_NAMES)[number];

export type AttributedSource = { name: SyncedSourceName; syncedAt: Date | null };

/** The synced sources with when each last synced, for /attribution; null until the first sync. */
export async function attributionSources(): Promise<AttributedSource[]> {
  const snapshots = new Map((await listSourceSnapshots()).map((row) => [row.source, row.fetchedAt]));
  return SYNCED_SOURCE_NAMES.map((name) => ({ name, syncedAt: snapshots.get(name) ?? null }));
}
