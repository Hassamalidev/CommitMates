import 'server-only';

import { AppError, ForbiddenError, hasRole, type Member, type RoleRequirement } from '@commitmates/core';
import { notFound } from 'next/navigation';

import { authCopy } from '@/copy/auth';

import { getCurrentMember } from './auth';

/** HTTP status for a request without a valid session (protocol constant). */
const UNAUTHENTICATED = 401;

export class UnauthenticatedError extends AppError {
  constructor() {
    super('auth.required', authCopy.errors.signInRequired, UNAUTHENTICATED);
  }
}

/** Every Server Action and protected route calls one of these first (CLAUDE.md §5.11). */
export async function requireUser(): Promise<Member> {
  const member = await getCurrentMember();
  if (!member) throw new UnauthenticatedError();
  if (member.status === 'suspended') throw new ForbiddenError('auth.suspended', authCopy.errors.suspended);
  return member;
}

export async function requireVerified(): Promise<Member> {
  const member = await requireUser();
  if (!member.verified) throw new ForbiddenError('auth.unverified', authCopy.errors.verifyFirst);
  return member;
}

export async function requireRole(requirement: RoleRequirement): Promise<Member> {
  const member = await requireUser();
  if (!hasRole(member, requirement)) throw new ForbiddenError('auth.forbidden', authCopy.errors.notAllowed);
  return member;
}

/** Moderators of at least one university, and admins: who may open the admin area at all. */
export function canReview(member: Pick<Member, 'roles'>): boolean {
  return member.roles.length > 0;
}

/**
 * For admin-only pages inside the admin area, which moderators may also enter. Anyone else gets
 * a 404, so the page's existence is not advertised.
 */
export async function requireAdminPage(): Promise<Member> {
  const member = await getCurrentMember();
  if (member?.status !== 'active' || !hasRole(member, 'admin')) notFound();
  return member;
}
