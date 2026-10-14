import {
  ConflictError,
  NotFoundError,
  ValidationError,
  countDeadJobsSince,
  databaseSizeMb,
  getSetting,
  isSettingKey,
  listBudgets,
  listJobsByStatus,
  listSchedules,
  listSettingHistory,
  listSettingRows,
  listSourceSnapshots,
  oldestQueuedByPriority,
  queueDepth,
  requeueJob,
  resolveSetting,
  schemaForSetting,
  setOverride,
  writeAudit,
} from '@commitmates/db';
import { PRIORITY, setScheduleEnabled } from '@commitmates/jobs';

import type { Alert } from './schemas';

const MS_PER_SECOND = 1000; // allowed-literal: unit conversion
const MS_PER_HOUR = 60 * 60 * MS_PER_SECOND; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * MS_PER_HOUR; // allowed-literal: unit conversion

export type Health = Awaited<ReturnType<typeof getHealth>>;

/** Everything `/admin/health` shows, with the alerts derived from it (CLAUDE.md §5.13). */
export async function getHealth(now: Date = new Date()) {
  const [deadWindowHours, interactiveAlertSeconds, budgetAlertPct, sourceStaleDays, staleComputedDays, dbBudgetMb] =
    await Promise.all([
      getSetting('admin.deadJobWindowHours'),
      getSetting('admin.interactiveQueueAlertSeconds'),
      getSetting('admin.budgetAlertPct'),
      getSetting('admin.sourceStaleDays'),
      getSetting('admin.staleComputedDays'),
      getSetting('storage.dbBudgetMb'),
    ]);

  const [depth, oldest, deadJobs, budgets, sources, dbSizeMb, settingRows] = await Promise.all([
    queueDepth(),
    oldestQueuedByPriority(now),
    countDeadJobsSince(new Date(now.getTime() - deadWindowHours * MS_PER_HOUR)),
    listBudgets(),
    listSourceSnapshots(),
    databaseSizeMb(),
    listSettingRows(),
  ]);

  const staleCutoff = now.getTime() - staleComputedDays * MS_PER_DAY;
  const staleSettings = settingRows
    .filter((row) => row.minSample > 0 && row.computedAt !== null && row.computedAt.getTime() < staleCutoff)
    .map((row) => ({ key: row.key, computedAt: row.computedAt }));

  const alerts: Alert[] = [];
  if (deadJobs > 0) alerts.push({ key: 'dead_jobs', values: { count: deadJobs, hours: deadWindowHours } });

  const interactive = oldest.find((row) => row.priority === PRIORITY.INTERACTIVE);
  if (interactive) {
    const waitedSeconds = Math.floor((now.getTime() - interactive.oldestRunAt.getTime()) / MS_PER_SECOND);
    if (waitedSeconds > interactiveAlertSeconds) {
      alerts.push({ key: 'interactive_queue', values: { seconds: waitedSeconds } });
    }
  }
  if (dbSizeMb > dbBudgetMb * budgetAlertPct) {
    alerts.push({ key: 'database_size', values: { mb: Math.round(dbSizeMb), budgetMb: dbBudgetMb } });
  }
  const sourceCutoff = now.getTime() - sourceStaleDays * MS_PER_DAY;
  for (const source of sources) {
    if (source.lastError !== null) alerts.push({ key: 'source_error', values: { source: source.source } });
    else if (source.fetchedAt !== null && source.fetchedAt.getTime() < sourceCutoff) {
      alerts.push({ key: 'stale_source', values: { source: source.source, days: sourceStaleDays } });
    }
  }

  return {
    generatedAt: now,
    queue: { depth, oldest, deadJobs, deadWindowHours },
    budgets,
    sources,
    database: { sizeMb: dbSizeMb, budgetMb: dbBudgetMb },
    staleSettings,
    alerts,
  };
}

export type JobsOverview = Awaited<ReturnType<typeof getJobsOverview>>;

export async function getJobsOverview() {
  const limit = await getSetting('admin.jobListLimit');
  const [depth, queued, running, dead, failed, schedules] = await Promise.all([
    queueDepth(),
    listJobsByStatus('queued', limit),
    listJobsByStatus('running', limit),
    listJobsByStatus('dead', limit),
    listJobsByStatus('failed', limit),
    listSchedules(),
  ]);
  return { depth, queued, running, dead, failed, schedules };
}

/** Enables or disables a schedule. Audited. */
export async function toggleSchedule(actorUserId: string, name: string, enabled: boolean): Promise<void> {
  const schedules = await listSchedules();
  if (!schedules.some((schedule) => schedule.name === name)) {
    throw new NotFoundError('admin.schedule_not_found', 'That schedule no longer exists.');
  }
  await setScheduleEnabled(name, enabled);
  await writeAudit({
    actorUserId,
    action: enabled ? 'schedule.enabled' : 'schedule.disabled',
    targetType: 'job_schedule',
    targetId: name,
  });
}

/** Requeues a dead or failed job with fresh attempts. Audited. */
export async function retryJob(actorUserId: string, jobId: string): Promise<void> {
  const requeued = await requeueJob(jobId);
  if (!requeued) throw new ConflictError('admin.job_not_retryable', 'Only dead or failed jobs can be retried.');
  await writeAudit({ actorUserId, action: 'job.requeued', targetType: 'job', targetId: jobId });
}

export type SettingView = {
  key: string;
  valueType: string;
  unit: string | null;
  description: string;
  value: unknown;
  source: 'override' | 'computed' | 'default';
  defaultValue: unknown;
  computedValue: unknown;
  overrideValue: unknown;
  sampleSize: number;
  minSample: number;
  computedAt: Date | null;
};

export async function listSettings(): Promise<SettingView[]> {
  const rows = await listSettingRows();
  return rows.map((row) => {
    const resolved = resolveSetting(row);
    return {
      key: row.key,
      valueType: row.valueType,
      unit: row.unit,
      description: row.description,
      value: resolved.value,
      source: resolved.source,
      defaultValue: row.defaultValue,
      computedValue: row.computedValue,
      overrideValue: row.overrideValue,
      sampleSize: row.sampleSize,
      minSample: row.minSample,
      computedAt: row.computedAt,
    };
  });
}

/** Rows of history shown per setting. */
const HISTORY_LIMIT = 20;

export async function getSettingHistory(key: string) {
  if (!isSettingKey(key)) throw new NotFoundError('admin.setting_not_found', 'That setting does not exist.');
  return listSettingHistory(key, HISTORY_LIMIT);
}

/**
 * Sets an override from JSON text, or clears it when the text is empty. The value is
 * validated against the key's type before anything is written. History and audit rows
 * are written by `setOverride`.
 */
export async function overrideSetting(actorUserId: string, key: string, rawValue: string): Promise<void> {
  if (!isSettingKey(key)) throw new NotFoundError('admin.setting_not_found', 'That setting does not exist.');
  const text = rawValue.trim();
  if (text === '') {
    await setOverride(key, null, actorUserId);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ValidationError('admin.setting_not_json', 'Enter the value as JSON, for example 30, 0.5, "text" or ["a","b"].', {
      cause: error,
      field: 'value',
    });
  }
  const checked = schemaForSetting(key).safeParse(parsed);
  if (!checked.success) {
    throw new ValidationError('admin.setting_wrong_type', 'That value does not match this setting\'s type.', {
      cause: checked.error,
      field: 'value',
    });
  }
  await setOverride(key, checked.data, actorUserId);
}
