import { and, desc, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { auditLog, githubBudgets, jobSchedules, jobs, settings, settingsHistory, sourceSnapshots } from '../schema';

export type QueueDepthRow = { type: string; status: string; count: number };

export async function queueDepth(db: DbOrTx = getDb()): Promise<QueueDepthRow[]> {
  return db
    .select({ type: jobs.type, status: sql<string>`${jobs.status}::text`, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.type, jobs.status)
    .orderBy(jobs.type, jobs.status);
}

export type OldestQueuedRow = { priority: number; oldestRunAt: Date; count: number };

/** The longest-waiting runnable job per priority class. */
export async function oldestQueuedByPriority(now: Date, db: DbOrTx = getDb()): Promise<OldestQueuedRow[]> {
  const rows = await db.execute<{ priority: number; oldest_run_at: Date; count: number }>(sql`
    select priority, min(run_at) as oldest_run_at, count(*)::int as count
    from jobs where status = 'queued' and run_at <= ${now.toISOString()}::timestamptz
    group by priority order by priority desc`);
  return rows.map((row) => ({ priority: row.priority, oldestRunAt: new Date(row.oldest_run_at), count: row.count }));
}

export async function countDeadJobsSince(since: Date, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from jobs where status = 'dead' and updated_at >= ${since.toISOString()}::timestamptz`);
  return rows[0]?.count ?? 0;
}

export type JobListRow = {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  updatedAt: Date;
  lastError: string | null;
};

export async function listJobsByStatus(
  status: (typeof jobs.status.enumValues)[number],
  limit: number,
  db: DbOrTx = getDb(),
): Promise<JobListRow[]> {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: sql<string>`${jobs.status}::text`,
      priority: jobs.priority,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      runAt: jobs.runAt,
      updatedAt: jobs.updatedAt,
      lastError: jobs.lastError,
    })
    .from(jobs)
    .where(eq(jobs.status, status))
    .orderBy(desc(jobs.updatedAt), desc(jobs.id))
    .limit(limit);
}

/** Puts a dead or failed job back in the queue with a fresh set of attempts. Returns false if it was not requeueable. */
export async function requeueJob(jobId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(jobs)
    // The database's clock, the same one the claim query compares against.
    .set({ status: 'queued', attempts: 0, runAt: sql`now()`, lockedAt: null, lockedBy: null, userMessage: null })
    .where(and(eq(jobs.id, jobId), sql`${jobs.status} in ('dead', 'failed')`))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function listSchedules(db: DbOrTx = getDb()) {
  return db.select().from(jobSchedules).orderBy(jobSchedules.name);
}

export async function listBudgets(db: DbOrTx = getDb()) {
  return db.select().from(githubBudgets).orderBy(githubBudgets.tokenIdentity, githubBudgets.resource);
}

export async function listSourceSnapshots(db: DbOrTx = getDb()) {
  return db.select().from(sourceSnapshots).orderBy(sourceSnapshots.source);
}

/** Size of the current database in megabytes, as Postgres reports it. */
export async function databaseSizeMb(db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ mb: number }>(
    sql`select (pg_database_size(current_database()) / 1048576.0)::float8 as mb`,
  );
  return rows[0]?.mb ?? 0;
}

export async function listSettingRows(db: DbOrTx = getDb()) {
  return db.select().from(settings).orderBy(settings.key);
}

export async function listSettingHistory(key: string, limit: number, db: DbOrTx = getDb()) {
  return db
    .select()
    .from(settingsHistory)
    .where(eq(settingsHistory.key, key))
    .orderBy(desc(settingsHistory.id))
    .limit(limit);
}

export type AuditEntry = { actorUserId: string | null; action: string; targetType: string; targetId: string; data?: unknown };

/** Appends to the audit log. Every admin and moderator action calls this (CLAUDE.md §5.11). */
export async function writeAudit(entry: AuditEntry, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    data: entry.data ?? {},
  });
}
