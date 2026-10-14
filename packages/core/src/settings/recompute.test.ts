import { clearSettingsCache, getSetting, registeredRecomputeKeys, setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { registerAllRecomputes } from './recompute';

let database: TestDatabase;

/** Seeds `count` anonymous samples valued 1..count, one subject each. */
async function seed(metricKey: string, count: number, scale = 1): Promise<void> {
  await database.sql`
    insert into metric_samples (metric_key, value, subject_hash, salt_period, recorded_on)
    select ${metricKey}, n * ${scale}::float8, ${metricKey} || '-' || n, 1, current_date from generate_series(1, ${count}) as n`;
}

async function runNightly(): Promise<void> {
  const job = await enqueue('recompute_settings', {}, { idempotencyKey: `test:${Date.now()}:${Math.random()}` });
  await runTick({ budgetMs: 30_000, onlyJobId: job.id });
  clearSettingsCache();
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  await database.sql`truncate metric_samples, settings_history, jobs`;
  await database.sql`update settings set computed_value = null, sample_size = 0, computed_at = null`;
  clearSettingsCache();
});

describe('recompute_settings', () => {
  it('registers every computed key Phase 2 feeds, once', () => {
    registerAllRecomputes();
    registerAllRecomputes();
    expect(registeredRecomputeKeys().sort()).toEqual([
      'companion.stageCuts',
      'oss.maxResponseHours',
      'persona.earlyBird.share',
      'persona.marathoner.activeDayShare',
      'persona.nightOwl.share',
      'persona.sprinter.cv',
      'persona.weekendWarrior.share',
      'recruiter.readme.minChars',
    ]);
  });

  it('switches to computed values once samples reach min_sample, and records history', async () => {
    // 200 samples is the seeded min_sample of these keys (CLAUDE.md §5.5.1).
    await seed('persona.nightShare', 200, 0.001);
    await seed('oss.responseHours', 200);
    await seed('recruiter.readmeChars', 200, 10);
    await seed('companion.activityScore', 200, 0.005);
    await runNightly();

    // p80 of 0.001..0.200, p60 of 1..200, p40 of 10..2000 rounded, quantiles of 0.005..1.0.
    expect(await getSetting('persona.nightOwl.share')).toBeCloseTo(0.1602, 4);
    expect(await getSetting('oss.maxResponseHours')).toBeCloseTo(120.4, 4);
    expect(await getSetting('recruiter.readme.minChars')).toBe(806);
    const cuts = await getSetting('companion.stageCuts');
    expect(cuts).toHaveLength(4);
    expect(cuts[0]).toBeCloseTo(0.25375, 5);
    expect([...cuts].sort((a, b) => a - b)).toEqual(cuts);

    const history = await database.sql`select key, field, source from settings_history order by key`;
    expect(history.map((row) => row.key)).toEqual(['companion.stageCuts', 'oss.maxResponseHours', 'persona.nightOwl.share', 'recruiter.readme.minChars']);
    expect(history.every((row) => row.field === 'computed' && row.source === 'recompute')).toBe(true);
    const [row] = await database.sql`select sample_size from settings where key = 'persona.nightOwl.share'`;
    expect(row?.sample_size).toBe(200);
  });

  it('keeps the default while there are fewer samples than min_sample', async () => {
    await seed('persona.nightShare', 50, 0.01);
    await runNightly();
    const [row] = await database.sql`select computed_value, sample_size from settings where key = 'persona.nightOwl.share'`;
    expect(row?.sample_size).toBe(50);
    expect(row?.computed_value).not.toBeNull();
    expect(await getSetting('persona.nightOwl.share')).toBe(0.35);
  });

  it('writes no history when a recompute barely moves the value', async () => {
    await seed('oss.responseHours', 200);
    await runNightly();
    await database.sql`insert into metric_samples (metric_key, value, subject_hash, salt_period, recorded_on) values ('oss.responseHours', 120, 'extra', 1, current_date)`;
    await runNightly();
    const history = await database.sql`select 1 from settings_history where key = 'oss.maxResponseHours'`;
    expect(history).toHaveLength(1);
  });
});
