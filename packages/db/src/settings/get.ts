import { eq } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { ConfigError } from '../errors';
import { auditLog, settings, settingsHistory } from '../schema';

import { type SettingKey } from './keys';
import { isSettingKey, schemaForSetting, type SettingValue } from './schemas';

export type SettingRow = {
  key: string;
  defaultValue: unknown;
  computedValue: unknown;
  overrideValue: unknown;
  sampleSize: number;
  minSample: number;
};

export type SettingSource = 'override' | 'computed' | 'default';

/**
 * Resolution order (CLAUDE.md §5.5): override, then the computed value once enough
 * samples back it, then the default.
 */
export function resolveSetting(row: SettingRow): { value: unknown; source: SettingSource } {
  if (row.overrideValue !== null && row.overrideValue !== undefined) {
    return { value: row.overrideValue, source: 'override' };
  }
  const computedReady =
    row.computedValue !== null &&
    row.computedValue !== undefined &&
    row.minSample > 0 &&
    row.sampleSize >= row.minSample;
  if (computedReady) return { value: row.computedValue, source: 'computed' };
  return { value: row.defaultValue, source: 'default' };
}

type Snapshot = { rows: Map<string, SettingRow>; loadedAt: number };

let snapshot: Snapshot | undefined;

/** Drops the in-memory snapshot; the next read loads fresh values. */
export function clearSettingsCache(): void {
  snapshot = undefined;
}

async function loadSnapshot(db: DbOrTx): Promise<Snapshot> {
  const rows = await db
    .select({
      key: settings.key,
      defaultValue: settings.defaultValue,
      computedValue: settings.computedValue,
      overrideValue: settings.overrideValue,
      sampleSize: settings.sampleSize,
      minSample: settings.minSample,
    })
    .from(settings);
  return { rows: new Map(rows.map((row) => [row.key, row])), loadedAt: Date.now() };
}

function parseValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const result = schemaForSetting(key).safeParse(value);
  if (!result.success) {
    throw new ConfigError('settings.invalid_value', `Stored value of "${key}" does not match its type`, {
      cause: result.error,
    });
  }
  return result.data as SettingValue<K>;
}

function readFrom<K extends SettingKey>(current: Snapshot, key: K): SettingValue<K> {
  const row = current.rows.get(key);
  if (!row) throw new ConfigError('settings.missing_row', `Setting "${key}" has no row; is the seed migration applied?`);
  return parseValue(key, resolveSetting(row).value);
}

/**
 * Reads a setting. Values are served from one in-memory snapshot of the whole table,
 * reloaded once it is older than `settings.cacheMs`.
 */
export async function getSetting<K extends SettingKey>(key: K, db: DbOrTx = getDb()): Promise<SettingValue<K>> {
  if (!isSettingKey(key)) throw new ConfigError('settings.unknown_key', `Unknown settings key "${String(key)}"`);

  if (snapshot) {
    const maxAgeMs = readFrom(snapshot, 'settings.cacheMs');
    if (Date.now() - snapshot.loadedAt > maxAgeMs) snapshot = undefined;
  }
  snapshot ??= await loadSnapshot(db);
  return readFrom(snapshot, key);
}

/** The seeded default of a setting, ignoring computed values and overrides. */
export async function settingDefault<K extends SettingKey>(key: K, db: DbOrTx = getDb()): Promise<SettingValue<K>> {
  if (!isSettingKey(key)) throw new ConfigError('settings.unknown_key', `Unknown settings key "${String(key)}"`);
  const [row] = await db.select({ defaultValue: settings.defaultValue }).from(settings).where(eq(settings.key, key));
  if (!row) throw new ConfigError('settings.missing_row', `Setting "${key}" has no row; is the seed migration applied?`);
  return parseValue(key, row.defaultValue);
}

/** Largest relative difference between two values; non-numeric changes count as a full change. */
export function relativeChange(previous: unknown, next: unknown): number {
  if (typeof previous === 'number' && typeof next === 'number') {
    if (previous === next) return 0;
    const scale = Math.max(Math.abs(previous), Math.abs(next));
    return scale === 0 ? 0 : Math.abs(next - previous) / scale;
  }
  if (Array.isArray(previous) && Array.isArray(next) && previous.length === next.length) {
    return previous.reduce<number>((max, item, index) => Math.max(max, relativeChange(item, next[index])), 0);
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    let max = 0;
    for (const key of keys) max = Math.max(max, relativeChange(previous[key], next[key]));
    return max;
  }
  return JSON.stringify(previous) === JSON.stringify(next) ? 0 : 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Stores a value computed from real data together with the sample size behind it.
 * A history row is written only when the value moved by more than `settings.historyMinDelta`.
 */
export async function setComputed(
  key: SettingKey,
  value: unknown,
  sampleSize: number,
  db: DbOrTx = getDb(),
): Promise<void> {
  if (!isSettingKey(key)) throw new ConfigError('settings.unknown_key', `Unknown settings key "${String(key)}"`);
  const parsed: unknown = parseValue(key, value);
  const minDelta = await getSetting('settings.historyMinDelta', db);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ computedValue: settings.computedValue })
      .from(settings)
      .where(eq(settings.key, key))
      .for('update');
    if (!row) throw new ConfigError('settings.missing_row', `Setting "${key}" has no row`);

    await tx
      .update(settings)
      .set({ computedValue: parsed, sampleSize, computedAt: new Date() })
      .where(eq(settings.key, key));

    const changed = row.computedValue === null || relativeChange(row.computedValue, parsed) > minDelta;
    if (changed) {
      await tx.insert(settingsHistory).values({
        key,
        field: 'computed',
        oldValue: row.computedValue,
        newValue: parsed,
        source: 'recompute',
      });
    }
  });
  clearSettingsCache();
}

/** Sets or clears (`null`) an admin override. Always recorded in history and the audit log. */
export async function setOverride(
  key: SettingKey,
  value: unknown,
  actorUserId: string,
  db: DbOrTx = getDb(),
): Promise<void> {
  if (!isSettingKey(key)) throw new ConfigError('settings.unknown_key', `Unknown settings key "${String(key)}"`);
  const parsed: unknown = value === null ? null : parseValue(key, value);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ overrideValue: settings.overrideValue })
      .from(settings)
      .where(eq(settings.key, key))
      .for('update');
    if (!row) throw new ConfigError('settings.missing_row', `Setting "${key}" has no row`);

    await tx.update(settings).set({ overrideValue: parsed }).where(eq(settings.key, key));
    await tx.insert(settingsHistory).values({
      key,
      field: 'override',
      oldValue: row.overrideValue,
      newValue: parsed,
      source: 'admin',
      actorUserId,
    });
    await tx.insert(auditLog).values({
      actorUserId,
      action: parsed === null ? 'settings.override_cleared' : 'settings.override_set',
      targetType: 'setting',
      targetId: key,
      data: { old: row.overrideValue, new: parsed },
    });
  });
  clearSettingsCache();
}

/** Prefixes of settings that recompute jobs create per category, outside the static key registry (CLAUDE.md §5.5.1). */
export type CategorySettingPrefix = 'graveyard.idleMonths';

/**
 * A per-category number such as `graveyard.idleMonths.<category>`, resolved like any setting.
 * `null` until a recompute job has created the row; callers fall back to the default key.
 */
export async function getCategoryNumber(prefix: CategorySettingPrefix, category: string, db: DbOrTx = getDb()): Promise<number | null> {
  // Reading a registered key refreshes the snapshot when it is older than settings.cacheMs.
  await getSetting('settings.cacheMs', db);
  const row = snapshot?.rows.get(`${prefix}.${category}`);
  if (!row) return null;
  const { value } = resolveSetting(row);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
