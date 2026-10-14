import { normalizeName } from '@commitmates/algorithms';
import {
  ValidationError,
  findSimilarDepartment,
  getDepartment,
  getProfileDetails,
  getSetting,
  insertDepartment,
  knownTags,
  listDepartments,
  popularTags,
  saveProfileDetails,
  schema,
  type Department,
} from '@commitmates/db';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import type { Member } from './schemas';

/** pg_trgm's own default similarity threshold; §8 F10 step 7 names 0.6 for departments. */
const DEPARTMENT_SIMILARITY = 0.6; // allowed-literal: trigram similarity threshold from the spec (§8 F10 step 7)
/** Tag suggestions offered for learning goals. */
const GOAL_SUGGESTIONS = 200;
/** Longest department name accepted. */
const MAX_DEPARTMENT_LENGTH = 120;

/** Roles a member may pick; `supervisor` is granted only by an approval (§8 F22). */
const SELF_SERVICE_ROLES = schema.profileRole.enumValues.filter((role) => role !== 'supervisor') as ['student', 'alumni', 'supervisor_pending'];

const checkbox = z.union([z.boolean(), z.literal('on'), z.literal('')]).transform((value) => value === true || value === 'on');

export const onboardingDetailsSchema = z.object({
  role: z.enum(SELF_SERVICE_ROLES),
  gradYear: z.union([z.literal(''), z.coerce.number().int()]).transform((value) => (value === '' ? null : value)),
  /** A department picked or typed; matched against existing ones. */
  department: z.string().trim().max(MAX_DEPARTMENT_LENGTH),
  /** Comma-separated tags. */
  learningGoals: z.string(),
  visibility: z.enum(schema.profileVisibility.enumValues),
  shareTodayStatus: checkbox,
  emailDigest: checkbox,
  timezone: z.string().trim().min(1),
});

const isTimezone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * The department for a typed name (CLAUDE.md §8 F10 step 7): an existing department of the
 * university whose normalized name is similar enough is reused, so spellings converge; otherwise
 * a new one is created.
 */
export async function resolveDepartment(universityId: string, typed: string, createdBy: string): Promise<Department> {
  const normalized = normalizeName(typed);
  if (normalized === '') throw new ValidationError('onboarding.department_invalid', 'Enter your department name.', { field: 'department' });
  const similar = await findSimilarDepartment(universityId, normalized, DEPARTMENT_SIMILARITY);
  return similar ?? insertDepartment({ universityId, name: typed.trim().replace(/\s+/g, ' '), normalizedName: normalized, createdBy });
}

/** Saves the onboarding details (§8 F10 step 7) for a verified member and marks them onboarded. */
export async function saveOnboardingDetails(member: Pick<Member, 'id' | 'verified' | 'universityId'>, raw: unknown, now: Date = new Date()): Promise<void> {
  if (!member.verified || member.universityId === null) {
    throw new ValidationError('onboarding.verify_first', 'Verify your university first.');
  }
  const input = onboardingDetailsSchema.parse(raw);
  const [maxGoals, maxAhead, maxBehind] = await Promise.all([
    getSetting('profile.maxLearningGoals'),
    getSetting('profile.gradYearMaxAhead'),
    getSetting('profile.gradYearMaxBehind'),
  ]);

  const year = now.getUTCFullYear();
  if (input.gradYear !== null && (input.gradYear < year - maxBehind || input.gradYear > year + maxAhead)) {
    throw new ValidationError('onboarding.grad_year', `Enter a year between ${year - maxBehind} and ${year + maxAhead}.`, { field: 'gradYear' });
  }
  if (!isTimezone(input.timezone)) throw new ValidationError('onboarding.timezone', 'Pick a valid timezone.', { field: 'timezone' });

  const goals = [...new Set(input.learningGoals.split(',').flatMap((goal) => normalizeTag(goal) ?? []))];
  if (goals.length > maxGoals) {
    throw new ValidationError('onboarding.too_many_goals', `Pick at most ${maxGoals} learning goals.`, { field: 'learningGoals' });
  }
  const known = await knownTags(goals);
  const unknown = goals.filter((goal) => !known.has(goal));
  if (unknown.length > 0) {
    throw new ValidationError('onboarding.unknown_goals', `We don't know these tags yet: ${unknown.join(', ')}. Pick from the suggestions.`, {
      field: 'learningGoals',
    });
  }

  let departmentId: string | null = null;
  if (input.department !== '') {
    // A suggestion carries its id; anything else is matched by name.
    const picked = /^[0-9a-f-]{36}$/.test(input.department) ? await getDepartment(input.department, member.universityId) : null;
    departmentId = (picked ?? (await resolveDepartment(member.universityId, input.department, member.id))).id;
  }

  await saveProfileDetails(
    member.id,
    {
      role: input.role,
      gradYear: input.gradYear,
      departmentId,
      learningGoals: goals,
      visibility: input.visibility,
      shareTodayStatus: input.shareTodayStatus,
      timezone: input.timezone,
      emailDigest: input.emailDigest,
    },
    now,
  );
}

/** What the details form needs: departments, goal suggestions, the year range and saved values. */
export async function getOnboardingOptions(member: Pick<Member, 'id' | 'universityId'>, now: Date = new Date()) {
  const [departments, suggestions, details, maxAhead, maxBehind, maxGoals] = await Promise.all([
    member.universityId ? listDepartments(member.universityId) : Promise.resolve([]),
    popularTags(GOAL_SUGGESTIONS),
    getProfileDetails(member.id),
    getSetting('profile.gradYearMaxAhead'),
    getSetting('profile.gradYearMaxBehind'),
    getSetting('profile.maxLearningGoals'),
  ]);
  const year = now.getUTCFullYear();
  return { departments, suggestions, details, years: { min: year - maxBehind, max: year + maxAhead }, maxGoals };
}
