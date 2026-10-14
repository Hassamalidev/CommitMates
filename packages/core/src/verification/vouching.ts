import {
  NotFoundError,
  ValidationError,
  claimUniversity,
  findMemberByLogin,
  getSetting,
  getUniversity,
  getVerificationState,
  getVouchProgress,
  hasVouched,
  searchUniversities,
  vouchFor,
  type UniversitySummary,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Results shown in the university picker. */
const SEARCH_LIMIT = 10;
/** Shortest query worth searching for. */
const MIN_QUERY_LENGTH = 2;
/** Longest query accepted. */
const MAX_QUERY_LENGTH = 100;

const querySchema = z.string().trim().min(MIN_QUERY_LENGTH).max(MAX_QUERY_LENGTH);

/** Universities by name for the vouching path (CLAUDE.md §8 F10 step 5); empty for a short query. */
export async function findUniversities(query: string): Promise<UniversitySummary[]> {
  const parsed = querySchema.safeParse(query);
  return parsed.success ? searchUniversities(parsed.data, SEARCH_LIMIT) : [];
}

/** A member without a working university email says which university they attend. */
export async function chooseUniversityForVouching(member: Pick<Member, 'id' | 'verified'>, raw: unknown): Promise<{ universityName: string }> {
  const { universityId } = z.object({ universityId: z.uuid() }).parse(raw);
  if (member.verified) {
    throw new ValidationError('vouch.already_verified', 'You are already verified. To change university, verify with the new university email.');
  }
  const university = await getUniversity(universityId);
  if (!university) throw new NotFoundError('universities.not_found', 'That university does not exist.');
  await claimUniversity(member.id, universityId);
  return { universityName: university.name };
}

export type VouchingStatus = { universityId: string; universityName: string; vouches: number; required: number };

/** The member's chosen university and vouch count, or `null` when they have not chosen one. */
export async function getVouchingStatus(userId: string): Promise<VouchingStatus | null> {
  const [progress, required] = await Promise.all([getVouchProgress(userId), getSetting('verify.vouchesRequired')]);
  return progress ? { ...progress, required } : null;
}

/**
 * Whether `viewerId` may vouch for `ownerId` now: the owner is unverified and has chosen a
 * university, the viewer is an active member verified there for at least `verify.voucherMinDays`,
 * and has not vouched for them already. Decides whether the profile page shows the button.
 */
export async function canVouchFor(viewerId: string, ownerId: string, now: Date = new Date()): Promise<boolean> {
  if (viewerId === ownerId) return false;
  const [progress, viewer, minDays] = await Promise.all([getVouchProgress(ownerId), getVerificationState(viewerId), getSetting('verify.voucherMinDays')]);
  if (!progress || viewer?.status !== 'active' || viewer.verifiedAt === null || viewer.universityId !== progress.universityId) return false;
  if (viewer.verifiedAt.getTime() > now.getTime() - minDays * MS_PER_DAY) return false;
  return !(await hasVouched(viewerId, ownerId));
}

/**
 * Vouches for a member (CLAUDE.md §8 F10 step 5). At `verify.vouchesRequired` vouches the member
 * is verified with `verified_via = 'vouch'`.
 */
export async function vouchForMember(voucher: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<{ vouches: number; required: number; verified: boolean }> {
  const { login } = z.object({ login: z.string().trim().min(1) }).parse(raw);
  const vouchee = await findMemberByLogin(login.replace(/^@/, ''));
  if (!vouchee) throw new NotFoundError('vouch.unknown_member', 'No member has that GitHub login.');
  const [required, voucherMinDays] = await Promise.all([getSetting('verify.vouchesRequired'), getSetting('verify.voucherMinDays')]);
  const outcome = await vouchFor(voucher.id, vouchee.userId, now, { required, voucherMinDays });
  switch (outcome.status) {
    case 'vouched':
      return { vouches: outcome.vouches, required, verified: outcome.verified };
    case 'already_vouched':
      throw new ValidationError('vouch.already_vouched', 'You already vouched for this member.');
    case 'no_claim':
      throw new ValidationError('vouch.not_needed', 'This member is not waiting for vouches.');
    case 'voucher_not_eligible':
      throw new ValidationError(
        'vouch.not_eligible',
        `Only members verified at the same university for at least ${voucherMinDays} days can vouch.`,
      );
  }
}
