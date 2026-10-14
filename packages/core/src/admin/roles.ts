import {
  ForbiddenError,
  ValidationError,
  auditTargetTypes,
  findMemberByLogin,
  getUniversity,
  listAuditLog,
  listRoleGrants,
  setAdminRole,
  type AuditEntryRow,
  type RoleGrant,
  type UniversitySummary,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';
import { hasRole } from '../profiles/service';

/** Audit entries per page. */
export const AUDIT_PAGE_SIZE = 50;

type Actor = Pick<Member, 'id' | 'roles'>;

function requireAdmin(member: Actor): void {
  if (!hasRole(member, 'admin')) throw new ForbiddenError('roles.forbidden', 'Only admins can do that.');
}

/** Every role grant (CLAUDE.md §5.11); admins only. */
export async function listRoles(member: Actor): Promise<RoleGrant[]> {
  requireAdmin(member);
  return listRoleGrants();
}

export const adminChangeSchema = z.object({ login: z.string().trim().min(1), grant: z.boolean() });

/**
 * Grants or revokes the admin role (admins only). An admin cannot revoke their own role, and the
 * last admin stays, so the system is never left without one.
 */
export async function changeAdmin(member: Actor, raw: unknown): Promise<{ changed: boolean }> {
  requireAdmin(member);
  const input = adminChangeSchema.parse(raw);
  const target = await findMemberByLogin(input.login.replace(/^@/, ''));
  if (!target) throw new ValidationError('roles.unknown_member', 'No member has that GitHub login.', { field: 'login' });
  if (!input.grant && target.userId === member.id) {
    throw new ValidationError('roles.self_revoke', 'Ask another admin to remove your admin role.', { field: 'login' });
  }
  const outcome = await setAdminRole(target.userId, input.grant, member.id);
  if (outcome.status === 'last_admin') throw new ValidationError('roles.last_admin', 'The last admin cannot be removed.', { field: 'login' });
  return { changed: outcome.status === 'changed' };
}

/** Longest filter text accepted. */
const MAX_FILTER_LENGTH = 100;

/** An empty filter field means no filter. */
const optionalFilter = z
  .string()
  .trim()
  .max(MAX_FILTER_LENGTH)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const auditFilterSchema = z.object({
  action: optionalFilter,
  targetType: optionalFilter,
  before: z.coerce.number().int().positive().optional(),
});

/** One page of the audit log (admins only), newest first, with the cursor for the next page. */
export async function readAuditLog(member: Actor, raw: unknown): Promise<{ entries: AuditEntryRow[]; next: number | null; targetTypes: string[] }> {
  requireAdmin(member);
  const filter = auditFilterSchema.parse(raw);
  const [entries, targetTypes] = await Promise.all([
    listAuditLog({ action: filter.action, targetType: filter.targetType, before: filter.before }, AUDIT_PAGE_SIZE + 1),
    auditTargetTypes(),
  ]);
  const page = entries.slice(0, AUDIT_PAGE_SIZE);
  return { entries: page, next: entries.length > AUDIT_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null, targetTypes };
}

/**
 * What a member may moderate (CLAUDE.md §5.11): admins everything; a moderator the universities
 * they moderate. Anyone else is refused.
 */
export async function moderationScope(member: Actor): Promise<{ admin: boolean; universities: UniversitySummary[] }> {
  const admin = hasRole(member, 'admin');
  const ids = member.roles.flatMap((role) => (role.role === 'uni_moderator' && role.universityId ? [role.universityId] : []));
  if (!admin && ids.length === 0) throw new ForbiddenError('moderation.forbidden', "You don't moderate anything.");
  const universities = (await Promise.all(ids.map((id) => getUniversity(id)))).flatMap((university) => (university ? [university] : []));
  return { admin, universities };
}
