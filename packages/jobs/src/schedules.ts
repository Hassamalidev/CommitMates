import { getDb, getLogger, schema, type DbOrTx } from '@commitmates/db';
import { CronExpressionParser } from 'cron-parser';
import { and, eq, lte, sql } from 'drizzle-orm';

import { enqueue } from './enqueue';
import { PRIORITY } from './priorities';
import { getHandler } from './registry';

/** The next time a cron expression fires after `after`, in UTC. */
export function nextCronRun(cronExpr: string, after: Date): Date {
  return CronExpressionParser.parse(cronExpr, { currentDate: after, tz: 'UTC' }).next().toDate();
}

/**
 * Enqueues every due schedule once and advances it (CLAUDE.md §5.4). The idempotency
 * key carries the due time, so two ticks racing on the same schedule create one job.
 */
export async function evaluateSchedules(now: Date, db: DbOrTx = getDb()): Promise<number> {
  let enqueued = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.jobSchedules)
      .where(and(eq(schema.jobSchedules.enabled, true), lte(schema.jobSchedules.nextRunAt, now)))
      .for('update', { skipLocked: true });

    for (const schedule of due) {
      let nextRunAt: Date;
      try {
        nextRunAt = nextCronRun(schedule.cronExpr, now);
      } catch (error) {
        getLogger().error({ schedule: schedule.name, err: error }, 'invalid cron expression; schedule disabled');
        await tx
          .update(schema.jobSchedules)
          .set({ enabled: false })
          .where(eq(schema.jobSchedules.name, schedule.name));
        continue;
      }
      await enqueue(schedule.jobType, schedule.payload, {
        idempotencyKey: `schedule:${schedule.name}:${schedule.nextRunAt.toISOString()}`,
        priority: getHandler(schedule.jobType)?.priority ?? PRIORITY.MAINTENANCE,
        db: tx,
      });
      await tx
        .update(schema.jobSchedules)
        .set({ lastRunAt: now, nextRunAt })
        .where(eq(schema.jobSchedules.name, schedule.name));
      enqueued += 1;
    }
  });
  return enqueued;
}

/** Inserts or updates a schedule; used by tests and admin tooling. Production schedules come from migrations. */
export async function upsertSchedule(
  input: { name: string; cronExpr: string; jobType: string; payload?: unknown; nextRunAt?: Date },
  db: DbOrTx = getDb(),
): Promise<void> {
  const nextRunAt = input.nextRunAt ?? nextCronRun(input.cronExpr, new Date());
  await db
    .insert(schema.jobSchedules)
    .values({
      name: input.name,
      cronExpr: input.cronExpr,
      jobType: input.jobType,
      payload: input.payload ?? {},
      nextRunAt,
    })
    .onConflictDoUpdate({
      target: schema.jobSchedules.name,
      set: { cronExpr: input.cronExpr, jobType: input.jobType, payload: input.payload ?? {}, nextRunAt },
    });
}

export async function setScheduleEnabled(name: string, enabled: boolean, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(schema.jobSchedules)
    .set({ enabled, ...(enabled ? { nextRunAt: sql`greatest(${schema.jobSchedules.nextRunAt}, now())` } : {}) })
    .where(eq(schema.jobSchedules.name, name));
}
