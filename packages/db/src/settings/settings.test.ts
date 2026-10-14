import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../errors';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '../testing';

import {
  SettingKeys,
  clearRecomputeRegistry,
  clearSettingsCache,
  getSetting,
  metricPercentile,
  recomputeSettings,
  registerRecompute,
  relativeChange,
  resolveSetting,
  schemaForSetting,
  setComputed,
  setOverride,
  type SettingKey,
} from './index';

let database: TestDatabase;

beforeAll(async () => {
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(() => {
  clearSettingsCache();
  clearRecomputeRegistry();
});

describe('resolveSetting', () => {
  const base = { key: 'k', defaultValue: 1, computedValue: null, overrideValue: null, sampleSize: 0, minSample: 0 };

  it('uses the default when nothing else is set', () => {
    expect(resolveSetting(base)).toEqual({ value: 1, source: 'default' });
  });

  it('uses the computed value only with enough samples', () => {
    expect(resolveSetting({ ...base, computedValue: 2, sampleSize: 99, minSample: 100 }).source).toBe('default');
    expect(resolveSetting({ ...base, computedValue: 2, sampleSize: 100, minSample: 100 })).toEqual({
      value: 2,
      source: 'computed',
    });
  });

  it('never uses a computed value when min_sample is 0', () => {
    expect(resolveSetting({ ...base, computedValue: 2, sampleSize: 500, minSample: 0 }).source).toBe('default');
  });

  it('lets an override win, including falsy values', () => {
    const row = { ...base, computedValue: 2, sampleSize: 100, minSample: 100 };
    expect(resolveSetting({ ...row, overrideValue: 3 })).toEqual({ value: 3, source: 'override' });
    expect(resolveSetting({ ...row, overrideValue: 0 })).toEqual({ value: 0, source: 'override' });
    expect(resolveSetting({ ...row, overrideValue: false })).toEqual({ value: false, source: 'override' });
  });
});

describe('seed migration', () => {
  it('contains exactly the keys in the registry, with matching types', async () => {
    const rows = await database.sql<{ key: string; value_type: string }[]>`select key, value_type from settings`;
    const seeded = Object.fromEntries(rows.map((row) => [row.key, row.value_type]));
    expect(seeded).toEqual({ ...SettingKeys });
  });

  it('stores a default that satisfies the schema of every key', async () => {
    const rows = await database.sql<{ key: SettingKey; default_value: unknown }[]>`
      select key, default_value from settings`;
    for (const row of rows) {
      const result = schemaForSetting(row.key).safeParse(row.default_value);
      expect(result.success, `default of ${row.key}`).toBe(true);
    }
  });

  it('describes every key', async () => {
    const rows = await database.sql`select key from settings where length(trim(description)) = 0`;
    expect(rows).toEqual([]);
  });
});

describe('getSetting', () => {
  it('reads typed defaults', async () => {
    expect(await getSetting('jobs.tickBudgetMs')).toBe(45000);
    expect(await getSetting('persona.percentile')).toBe(0.8);
    expect(await getSetting('graveyard.unfinishedTerms')).toContain('wip');
    expect(await getSetting('companion.stageCuts')).toEqual([0.25, 0.5, 0.75, 0.9]);
    expect((await getSetting('matching.weights')).study.sim).toBe(0.6);
    expect((await getSetting('compat.bands'))[0]).toEqual({ min: 0, key: 'different-worlds' });
  });

  it('rejects an unknown key', async () => {
    await expect(getSetting('nope.nothing' as SettingKey)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects a stored value that no longer matches its type', async () => {
    await database.sql`update settings set override_value = '"fast"'::jsonb where key = 'jobs.claimBatchSize'`;
    clearSettingsCache();
    await expect(getSetting('jobs.claimBatchSize')).rejects.toThrow(/settings.invalid_value/);
    await database.sql`update settings set override_value = null where key = 'jobs.claimBatchSize'`;
  });

  it('serves cached values until settings.cacheMs passes', async () => {
    expect(await getSetting('gap.maxGaps')).toBe(8);
    await database.sql`update settings set override_value = '5'::jsonb where key = 'gap.maxGaps'`;
    expect(await getSetting('gap.maxGaps')).toBe(8);

    await withSettings({ 'settings.cacheMs': 0 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(await getSetting('gap.maxGaps')).toBe(5);
    });
    await database.sql`update settings set override_value = null where key = 'gap.maxGaps'`;
  });
});

describe('withSettings', () => {
  it('overrides for the duration of the callback only', async () => {
    await withSettings({ 'matching.deckSize': 3 }, async () => {
      expect(await getSetting('matching.deckSize')).toBe(3);
    });
    expect(await getSetting('matching.deckSize')).toBe(15);
  });
});

describe('setComputed', () => {
  it('takes effect once the sample size reaches min_sample', async () => {
    const key = 'persona.nightOwl.share';
    await setComputed(key, 0.42, 150);
    expect(await getSetting(key)).toBe(0.35);
    await setComputed(key, 0.42, 200);
    expect(await getSetting(key)).toBe(0.42);
  });

  it('writes history only for changes above settings.historyMinDelta', async () => {
    const key = 'persona.sprinter.cv';
    const history = () =>
      database.sql<{ new_value: number }[]>`
        select new_value from settings_history where key = ${key} and field = 'computed' order by id`;

    await setComputed(key, 2, 300);
    await setComputed(key, 2.01, 310);
    await setComputed(key, 2.5, 320);
    expect((await history()).map((row) => row.new_value)).toEqual([2, 2.5]);
    expect(await getSetting(key)).toBe(2.5);
  });

  it('rejects a value of the wrong type', async () => {
    await expect(setComputed('persona.sprinter.cv', 'high', 300)).rejects.toThrow(/settings.invalid_value/);
  });
});

describe('setOverride', () => {
  it('wins over computed, is audited, and can be cleared', async () => {
    const actor = await insertTestUser(database.sql);
    const key = 'oss.maxResponseHours';
    await setComputed(key, 96, 500);
    expect(await getSetting(key)).toBe(96);

    await setOverride(key, 48, actor);
    expect(await getSetting(key)).toBe(48);

    await setOverride(key, null, actor);
    expect(await getSetting(key)).toBe(96);

    const history = await database.sql`
      select field, source, actor_user_id from settings_history where key = ${key} and field = 'override'`;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ source: 'admin', actor_user_id: actor });

    const audit = await database.sql<{ action: string }[]>`
      select action from audit_log where target_type = 'setting' and target_id = ${key} order by id`;
    expect(audit.map((row) => row.action)).toEqual(['settings.override_set', 'settings.override_cleared']);
  });

  it('validates JSON overrides against the schema of the key', async () => {
    const actor = await insertTestUser(database.sql);
    await expect(setOverride('compat.weights', { skill: 1 }, actor)).rejects.toThrow(/settings.invalid_value/);
  });
});

describe('relativeChange', () => {
  it('compares numbers, arrays and objects', () => {
    expect(relativeChange(100, 102)).toBeCloseTo(0.0196, 3);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange([1, 2], [1, 4])).toBe(0.5);
    expect(relativeChange({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(0);
    expect(relativeChange({ a: { x: 10 } }, { a: { x: 5 } })).toBe(0.5);
    expect(relativeChange(['a'], ['b'])).toBe(1);
    expect(relativeChange([1], [1, 2])).toBe(1);
  });
});

describe('recomputeSettings', () => {
  it('computes a percentile from metric samples and stores it with history', async () => {
    const values = Array.from({ length: 250 }, (_, index) => index / 250);
    await database.sql`
      insert into metric_samples ${database.sql(
        values.map((value, index) => ({
          metric_key: 'persona.morningShare',
          value,
          subject_hash: `subject-${index}`,
          salt_period: 1,
          recorded_on: '2026-10-01',
        })),
      )}`;

    registerRecompute('persona.earlyBird.share', (db) => metricPercentile('persona.morningShare', 0.8, db));
    registerRecompute('persona.weekendWarrior.share', (db) => metricPercentile('persona.weekendShare', 0.8, db));
    registerRecompute('recruiter.readme.minChars', () => Promise.reject(new Error('source down')));

    const report = await recomputeSettings();
    expect(report.updated).toEqual(['persona.earlyBird.share']);
    expect(report.empty).toEqual(['persona.weekendWarrior.share']);
    expect(report.failed.map((failure) => failure.key)).toEqual(['recruiter.readme.minChars']);

    expect(await getSetting('persona.earlyBird.share')).toBeCloseTo(0.7968, 3);
    const [row] = await database.sql<{ sample_size: number; computed_at: Date | null }[]>`
      select sample_size, computed_at from settings where key = 'persona.earlyBird.share'`;
    expect(row).toMatchObject({ sample_size: 250 });
    expect(row!.computed_at).toBeInstanceOf(Date);
    const history = await database.sql`
      select 1 from settings_history where key = 'persona.earlyBird.share' and source = 'recompute'`;
    expect(history).toHaveLength(1);
  });

  it('refuses to register a key twice', () => {
    registerRecompute('persona.sprinter.cv', () => Promise.resolve(null));
    expect(() => {
      registerRecompute('persona.sprinter.cv', () => Promise.resolve(null));
    }).toThrow(ConfigError);
  });
});
