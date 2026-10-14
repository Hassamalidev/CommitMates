import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { auditLog, githubIdentities, roles, universities } from '../schema';

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
