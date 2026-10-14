import { ConflictError, NotFoundError, ValidationError, getSetting, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { PRIORITY, enqueue } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getHealth,
  getJobsOverview,
  getSettingHistory,
  listSettings,
  overrideSetting,
  retryJob,
  toggleSchedule,
} from './service';

let database: TestDatabase;
let admin: string;
const NOW = new Date('2026-10-14T12:00:00.000Z');

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  admin = await insertTestUser(database.sql);
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  await database.sql`truncate jobs, source_snapshots, github_budgets, audit_log cascade`;
});

const alertKeys = async (now = NOW) => (await getHealth(now)).alerts.map((alert) => alert.key);

describe('getHealth', () => {
  it('reports an empty, healthy system without alerts', async () => {
    const health = await getHealth(NOW);
    expect(health.alerts).toEqual([]);
    expect(health.queue).toMatchObject({ depth: [], oldest: [], deadJobs: 0, deadWindowHours: 24 });
    expect(health.database.sizeMb).toBeGreaterThan(1);
    expect(health.database.budgetMb).toBe(450);
  });

  it('counts the queue by type and status', async () => {
    await enqueue('analyze_profile', {}, { priority: PRIORITY.INTERACTIVE });
    await enqueue('analyze_profile', {}, { priority: PRIORITY.INTERACTIVE });
    await enqueue('sync_linguist', {}, { priority: PRIORITY.MAINTENANCE });
    const health = await getHealth(new Date());
    expect(health.queue.depth).toEqual([
      { type: 'analyze_profile', status: 'queued', count: 2 },
      { type: 'sync_linguist', status: 'queued', count: 1 },
    ]);
    expect(health.queue.oldest.map((row) => [row.priority, row.count])).toEqual([
      [PRIORITY.INTERACTIVE, 2],
      [PRIORITY.MAINTENANCE, 1],
    ]);
  });

  it('alerts on dead jobs inside the window only', async () => {
    await database.sql`insert into jobs (type, status, max_attempts, updated_at)
                       values ('x', 'dead', 1, ${new Date(NOW.getTime() - 3_600_000)})`;
    // The updated_at trigger stamps "now" on insert-then-update only, so set it explicitly.
    await database.sql`alter table jobs disable trigger jobs_set_updated_at`;
    await database.sql`update jobs set updated_at = ${new Date(NOW.getTime() - 3_600_000)}`;
    expect(await alertKeys()).toEqual(['dead_jobs']);
    await database.sql`update jobs set updated_at = ${new Date(NOW.getTime() - 30 * 3_600_000)}`;
    await database.sql`alter table jobs enable trigger jobs_set_updated_at`;
    expect(await alertKeys()).toEqual([]);
  });

  it('alerts when an interactive job waits longer than the threshold', async () => {
    await enqueue('analyze_profile', {}, { priority: PRIORITY.INTERACTIVE, runAt: new Date(NOW.getTime() - 60_000) });
    expect(await alertKeys()).toEqual([]);
    await database.sql`update jobs set run_at = ${new Date(NOW.getTime() - 121_000)}`;
    const health = await getHealth(NOW);
    expect(health.alerts).toEqual([{ key: 'interactive_queue', values: { seconds: 121 } }]);
    // A slow maintenance job is not an alert.
    await database.sql`update jobs set priority = ${PRIORITY.MAINTENANCE}`;
    expect(await alertKeys()).toEqual([]);
  });

  it('alerts when the database passes the configured share of its budget', async () => {
    const keys = await withSettings({ 'storage.dbBudgetMb': 1 }, () => alertKeys());
    expect(keys).toEqual(['database_size']);
  });

  it('alerts on failing and stale sources', async () => {
    await database.sql`insert into source_snapshots (source, fetched_at, last_error) values
      ('fresh', ${new Date(NOW.getTime() - 86_400_000)}, null),
      ('old', ${new Date(NOW.getTime() - 15 * 86_400_000)}, null),
      ('broken', ${new Date(NOW.getTime() - 86_400_000)}, 'GitHubServerError: 503')`;
    const health = await getHealth(NOW);
    expect(health.alerts).toEqual([
      { key: 'source_error', values: { source: 'broken' } },
      { key: 'stale_source', values: { source: 'old', days: 14 } },
    ]);
    expect(health.sources).toHaveLength(3);
  });

  it('lists computed settings that have not been refreshed', async () => {
    await database.sql`update settings set computed_value = '0.4'::jsonb, computed_at = ${new Date(NOW.getTime() - 4 * 86_400_000)}
                       where key = 'persona.nightOwl.share'`;
    await database.sql`update settings set computed_value = '0.4'::jsonb, computed_at = ${new Date(NOW.getTime() - 86_400_000)}
                       where key = 'persona.earlyBird.share'`;
    const health = await getHealth(NOW);
    expect(health.staleSettings.map((row) => row.key)).toEqual(['persona.nightOwl.share']);
    await database.sql`update settings set computed_value = null, computed_at = null where key like 'persona.%'`;
  });
});

describe('jobs administration', () => {
  it('lists jobs by status and the schedules', async () => {
    await enqueue('a', {});
    await database.sql`insert into jobs (type, status, max_attempts, attempts, last_error) values ('b', 'dead', 3, 3, 'boom')`;
    const overview = await getJobsOverview();
    expect(overview.queued.map((job) => job.type)).toEqual(['a']);
    expect(overview.dead).toEqual([expect.objectContaining({ type: 'b', attempts: 3, lastError: 'boom' })]);
    expect(overview.schedules.map((schedule) => schedule.name)).toEqual(
      expect.arrayContaining(['recompute-settings', 'rotate-salts', 'cleanup-rate-buckets', 'sync-linguist']),
    );
  });

  it('retries a dead job with fresh attempts and audits it', async () => {
    const [dead] = await database.sql<{ id: string }[]>`
      insert into jobs (type, status, max_attempts, attempts, user_message) values ('b', 'dead', 3, 3, 'x') returning id`;
    await retryJob(admin, dead!.id, NOW);
    const [row] = await database.sql`select status, attempts, user_message from jobs where id = ${dead!.id}`;
    expect(row).toEqual({ status: 'queued', attempts: 0, user_message: null });
    const audit = await database.sql`select action, actor_user_id, target_id from audit_log`;
    expect(audit).toEqual([{ action: 'job.requeued', actor_user_id: admin, target_id: dead!.id }]);
  });

  it('refuses to retry a job that is not dead or failed', async () => {
    const job = await enqueue('a', {});
    await expect(retryJob(admin, job.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(retryJob(admin, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ConflictError);
    expect(await database.sql`select 1 from audit_log`).toHaveLength(0);
  });

  it('toggles a schedule and audits both directions', async () => {
    await toggleSchedule(admin, 'sync-linguist', false);
    let [row] = await database.sql`select enabled from job_schedules where name = 'sync-linguist'`;
    expect(row!.enabled).toBe(false);
    await toggleSchedule(admin, 'sync-linguist', true);
    [row] = await database.sql`select enabled, next_run_at from job_schedules where name = 'sync-linguist'`;
    expect(row!.enabled).toBe(true);
    const audit = await database.sql`select action from audit_log order by id`;
    expect(audit.map((entry) => entry.action)).toEqual(['schedule.disabled', 'schedule.enabled']);
    await expect(toggleSchedule(admin, 'nope', true)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('settings administration', () => {
  it('lists every setting with its resolved value and source', async () => {
    const all = await listSettings();
    expect(all.length).toBeGreaterThan(150);
    expect(all.find((setting) => setting.key === 'gap.maxGaps')).toMatchObject({
      value: 8,
      source: 'default',
      valueType: 'integer',
    });
  });

  it('overrides from JSON text, records history, and clears with an empty value', async () => {
    await overrideSetting(admin, 'gap.maxGaps', ' 5 ');
    expect(await getSetting('gap.maxGaps')).toBe(5);
    expect((await listSettings()).find((setting) => setting.key === 'gap.maxGaps')).toMatchObject({ source: 'override' });

    await overrideSetting(admin, 'graveyard.unfinishedTerms', '["todo","wip","later"]');
    expect(await getSetting('graveyard.unfinishedTerms')).toEqual(['todo', 'wip', 'later']);

    await overrideSetting(admin, 'gap.maxGaps', '');
    await overrideSetting(admin, 'graveyard.unfinishedTerms', '');
    expect(await getSetting('gap.maxGaps')).toBe(8);

    const history = await getSettingHistory('gap.maxGaps');
    expect(history.map((row) => [row.field, row.newValue, row.actorUserId])).toEqual([
      ['override', null, admin],
      ['override', 5, admin],
    ]);
    const audit = await database.sql`select action from audit_log where target_id = 'gap.maxGaps' order by id`;
    expect(audit.map((entry) => entry.action)).toEqual(['settings.override_set', 'settings.override_cleared']);
  });

  it('rejects text that is not JSON, the wrong type, and unknown keys', async () => {
    await expect(overrideSetting(admin, 'gap.maxGaps', 'five')).rejects.toMatchObject({
      code: 'admin.setting_not_json',
      field: 'value',
    });
    await expect(overrideSetting(admin, 'gap.maxGaps', '"5"')).rejects.toBeInstanceOf(ValidationError);
    await expect(overrideSetting(admin, 'gap.maxGaps', '2.5')).rejects.toMatchObject({ code: 'admin.setting_wrong_type' });
    await expect(overrideSetting(admin, 'compat.weights', '{"skill":1}')).rejects.toBeInstanceOf(ValidationError);
    await expect(overrideSetting(admin, 'no.such.key', '1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSettingHistory('no.such.key')).rejects.toBeInstanceOf(NotFoundError);
    expect(await getSetting('gap.maxGaps')).toBe(8);
  });
});
