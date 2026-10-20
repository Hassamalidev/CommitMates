import { and, asc, count, desc, eq, isNotNull, lt, lte, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { auditLog, githubIdentities, reports, roles, universities, users } from '../schema';

import { writeAudit } from './admin';

export type RoleGrant = {
  userId: string;
  login: string | null;
  role: 'admin' | 'uni_moderator';
  universityId: string | null;
  universityName: string | null;
  grantedAt: Date;
};

/** Every role grant, admins first, with logins and universities (CLAUDE.md §5.11). */
export async function listRoleGrants(db: DbOrTx = getDb()): Promise<RoleGrant[]> {
  return db
    .select({
      userId: roles.userId,
      login: githubIdentities.login,
      role: roles.role,
      universityId: roles.universityId,
      universityName: universities.name,
      grantedAt: roles.grantedAt,
    })
    .from(roles)
    .leftJoin(githubIdentities, eq(githubIdentities.userId, roles.userId))
    .leftJoin(universities, eq(universities.id, roles.universityId))
    .orderBy(asc(roles.role), asc(universities.name), asc(githubIdentities.login));
}

export type AdminChange = { status: 'changed' } | { status: 'unchanged' } | { status: 'last_admin' };

/**
 * Grants or revokes the global admin role, with an audit entry. The last admin cannot be revoked,
 * so the system always has someone who can manage it; the row lock serializes concurrent revokes.
 */
export async function setAdminRole(userId: string, grant: boolean, actorUserId: string, db: DbOrTx = getDb()): Promise<AdminChange> {
  return db.transaction(async (tx): Promise<AdminChange> => {
    const admins = await tx.select({ userId: roles.userId }).from(roles).where(eq(roles.role, 'admin')).for('update');
    const isAdmin = admins.some((row) => row.userId === userId);
    if (grant === isAdmin) return { status: 'unchanged' };
    if (!grant && admins.length <= 1) return { status: 'last_admin' };
    if (grant) {
      await tx.insert(roles).values({ userId, role: 'admin', grantedBy: actorUserId });
    } else {
      await tx.delete(roles).where(and(eq(roles.userId, userId), eq(roles.role, 'admin')));
    }
    await writeAudit(
      { actorUserId, action: grant ? 'role.grant' : 'role.revoke', targetType: 'user', targetId: userId, data: { role: 'admin' } },
      tx,
    );
    return { status: 'changed' };
  });
}

export type AuditEntryRow = {
  id: number;
  actorUserId: string | null;
  actorLogin: string | null;
  action: string;
  targetType: string;
  targetId: string;
  data: unknown;
  createdAt: Date;
};

export type AuditFilter = { action?: string | undefined; targetType?: string | undefined; before?: number | undefined };

/**
 * One page of the audit log, newest first, with keyset pagination on the id (CLAUDE.md §10.6).
 * `action` matches a prefix, so `role.` finds grants and revocations.
 */
export async function listAuditLog(filter: AuditFilter, limit: number, db: DbOrTx = getDb()): Promise<AuditEntryRow[]> {
  const conditions = [
    filter.action ? sql`${auditLog.action} like ${`${filter.action.replace(/[\\%_]/g, (char) => `\\${char}`)}%`}` : undefined,
    filter.targetType ? eq(auditLog.targetType, filter.targetType) : undefined,
    filter.before === undefined ? undefined : lt(auditLog.id, filter.before),
  ].filter((condition) => condition !== undefined);
  return db
    .select({
      id: auditLog.id,
      actorUserId: auditLog.actorUserId,
      actorLogin: githubIdentities.login,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      data: auditLog.data,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(githubIdentities, eq(githubIdentities.userId, auditLog.actorUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(limit);
}

/** The target types present in the log, for the filter. */
export async function auditTargetTypes(db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.select({ targetType: auditLog.targetType, uses: count() }).from(auditLog).groupBy(auditLog.targetType).orderBy(asc(auditLog.targetType));
  return rows.map((row) => row.targetType);
}

export type ReportRow = {
  id: string;
  reporterLogin: string | null;
  reason: string;
  details: string | null;
  targetMessage: string | null;
  createdAt: Date;
};

export type ReportGroup = {
  targetUserId: string;
  login: string;
  name: string | null;
  status: 'active' | 'suspended' | 'hidden_pending_review';
  universityId: string | null;
  universityName: string | null;
  isAdmin: boolean;
  reports: ReportRow[];
};

/**
 * Open reports grouped by the reported member, the group with the most recent report first. When
 * `universityIds` is given, only members of those universities (a moderator's scope, §5.11).
 */
export async function listOpenReportGroups(universityIds: readonly string[] | null, db: DbOrTx = getDb()): Promise<ReportGroup[]> {
  const rows = await db.execute<{
    id: string;
    target_user: string;
    reporter_login: string | null;
    reason: string;
    details: string | null;
    target_message: string | null;
    created_at: string;
    login: string;
    name: string | null;
    status: ReportGroup['status'];
    university_id: string | null;
    university_name: string | null;
    is_admin: boolean;
  }>(sql`
    select r.id, r.target_user, rg.login as reporter_login, r.reason, r.details, r.target_message, r.created_at,
           g.login, g.name, u.status, p.university_id, un.name as university_name,
           exists (select 1 from roles ro where ro.user_id = r.target_user and ro.role = 'admin') as is_admin
    from reports r
    join users u on u.id = r.target_user
    join github_identities g on g.user_id = r.target_user
    join profiles p on p.user_id = r.target_user
    left join universities un on un.id = p.university_id
    left join github_identities rg on rg.user_id = r.reporter
    where r.status = 'open'
      ${universityIds === null ? sql`` : sql`and p.university_id = any(${`{${universityIds.join(',')}}`}::uuid[])`}
    order by r.created_at desc, r.id`);
  const groups = new Map<string, ReportGroup>();
  for (const row of rows) {
    const group = groups.get(row.target_user) ?? {
      targetUserId: row.target_user,
      login: row.login,
      name: row.name,
      status: row.status,
      universityId: row.university_id,
      universityName: row.university_name,
      isAdmin: row.is_admin,
      reports: [],
    };
    group.reports.push({
      id: row.id,
      reporterLogin: row.reporter_login,
      reason: row.reason,
      details: row.details,
      targetMessage: row.target_message,
      createdAt: new Date(row.created_at),
    });
    groups.set(row.target_user, group);
  }
  return [...groups.values()];
}

/** A report with what is needed to check the moderator's scope. */
export async function getReport(reportId: string, db: DbOrTx = getDb()) {
  const rows = await db.execute<{ id: string; target_user: string; target_message: string | null; university_id: string | null }>(sql`
    select r.id, r.target_user, r.target_message, p.university_id
    from reports r join profiles p on p.user_id = r.target_user
    where r.id = ${reportId}`);
  const row = rows[0];
  return row ? { id: row.id, targetUser: row.target_user, targetMessage: row.target_message, universityId: row.university_id } : null;
}

export type ContextMessage = { id: string; authorLogin: string | null; kind: 'user' | 'system'; body: string; createdAt: Date; deleted: boolean };

/**
 * A reported message with up to `around` messages before and after it in its thread, oldest first
 * (§8 F12 "Moderation queue": shown only to the moderator handling the report).
 */
export async function messageContext(messageId: string, around: number, db: DbOrTx = getDb()): Promise<ContextMessage[]> {
  const rows = await db.execute<{ id: string; login: string | null; kind: 'user' | 'system'; body: string; created_at: string; deleted_at: string | null }>(sql`
    with target as (select thread_id, created_at, id from messages where id = ${messageId}),
    earlier as (
      select m.* from messages m, target t
      where m.thread_id = t.thread_id and (m.created_at, m.id) < (t.created_at, t.id)
      order by m.created_at desc, m.id desc limit ${around}),
    later as (
      select m.* from messages m, target t
      where m.thread_id = t.thread_id and (m.created_at, m.id) > (t.created_at, t.id)
      order by m.created_at, m.id limit ${around}),
    chosen as (
      select * from earlier
      union all select m.* from messages m join target t on m.id = t.id
      union all select * from later)
    select c.id, g.login, c.kind, c.body, c.created_at, c.deleted_at
    from chosen c left join github_identities g on g.user_id = c.author_user_id
    order by c.created_at, c.id`);
  return rows.map((row) => ({
    id: row.id,
    authorLogin: row.login,
    kind: row.kind,
    body: row.deleted_at === null ? row.body : '',
    createdAt: new Date(row.created_at),
    deleted: row.deleted_at !== null,
  }));
}

/** Resolves every open report about a member. */
export async function resolveOpenReports(
  targetUserId: string,
  status: 'actioned' | 'dismissed',
  resolvedBy: string,
  now: Date,
  db: DbOrTx = getDb(),
): Promise<number> {
  const rows = await db
    .update(reports)
    .set({ status, resolvedBy, resolvedAt: now })
    .where(and(eq(reports.targetUser, targetUserId), eq(reports.status, 'open')))
    .returning({ id: reports.id });
  return rows.length;
}

/** Sets a member's account status; `suspendedUntil` only applies to suspensions. */
export async function setAccountStatus(
  userId: string,
  status: 'active' | 'suspended' | 'hidden_pending_review',
  suspendedUntil: Date | null,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db
    .update(users)
    .set({ status, suspendedUntil: status === 'suspended' ? suspendedUntil : null })
    .where(eq(users.id, userId));
}

/** Ends suspensions whose time is up; returns whose. Bans (no end time) stay. */
export async function liftExpiredSuspensions(now: Date, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db
    .update(users)
    .set({ status: 'active', suspendedUntil: null })
    .where(and(eq(users.status, 'suspended'), isNotNull(users.suspendedUntil), lte(users.suspendedUntil, now)))
    .returning({ id: users.id });
  return rows.map((row) => row.id);
}

/** A member's account status, for moderation decisions. */
export async function getAccountStatus(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select({ status: users.status, suspendedUntil: users.suspendedUntil }).from(users).where(eq(users.id, userId));
  return row ?? null;
}
