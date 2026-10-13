import { sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { ConfigError } from '../errors';

import { setComputed } from './get';
import { type SettingKey } from './keys';

/** A value derived from real data, with the number of samples behind it. `null` means no data yet. */
export type Recomputed = { value: unknown; sampleSize: number } | null;

export type RecomputeFn = (db: DbOrTx) => Promise<Recomputed>;

const registry = new Map<SettingKey, RecomputeFn>();

/** Registers how a computed key is derived. Each key has exactly one function. */
export function registerRecompute(key: SettingKey, compute: RecomputeFn): void {
  if (registry.has(key)) throw new ConfigError('settings.duplicate_recompute', `"${key}" is already registered`);
  registry.set(key, compute);
}

export function registeredRecomputeKeys(): SettingKey[] {
  return [...registry.keys()];
}

/** Test helper: forget every registration. */
export function clearRecomputeRegistry(): void {
  registry.clear();
}

export type RecomputeReport = {
  updated: SettingKey[];
  /** Keys whose function found no data. */
  empty: SettingKey[];
  failed: { key: SettingKey; error: unknown }[];
};

/**
 * Runs every registered function and stores its result (job `recompute_settings`, nightly).
 * One failing key does not stop the others.
 */
export async function recomputeSettings(db: DbOrTx = getDb()): Promise<RecomputeReport> {
  const report: RecomputeReport = { updated: [], empty: [], failed: [] };
  for (const [key, compute] of registry) {
    try {
      const result = await compute(db);
      if (result === null) {
        report.empty.push(key);
        continue;
      }
      await setComputed(key, result.value, result.sampleSize, db);
      report.updated.push(key);
    } catch (error) {
      report.failed.push({ key, error });
    }
  }
  return report;
}

/**
 * Percentile of an anonymous metric over `metric_samples`, with the sample count.
 * The building block for most computed settings (e.g. p80 of night-share samples).
 */
export async function metricPercentile(
  metricKey: string,
  percentile: number,
  db: DbOrTx = getDb(),
): Promise<Recomputed> {
  const rows = await db.execute<{ value: number | null; count: number }>(sql`
    select percentile_cont(${percentile}) within group (order by value) as value, count(*)::int as count
    from metric_samples where metric_key = ${metricKey}`);
  const value = rows[0]?.value ?? null;
  const count = rows[0]?.count ?? 0;
  if (value === null || count === 0) return null;
  return { value, sampleSize: count };
}
