import { domainSuffixes, normalizeDomain } from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  countryName,
  createUniversityRequest,
  findMemberByLogin,
  findUniversitiesByDomainSuffixes,
  getUniversity,
  getUniversityRequest,
  isDisposableDomain,
  listModerators,
  listPendingUniversityRequests,
  reviewUniversityRequest,
  setModeratorRole,
  slugsStartingWith,
  type ModeratorRow,
  type PendingRequest,
} from '@commitmates/db';
import { kebab } from '@commitmates/sources';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';
import { hasRole } from '../profiles/service';

/** Longest hostname (RFC 1035). */
const MAX_DOMAIN_LENGTH = 253;
/** Longest university name accepted from a member or reviewer. */
const MAX_NAME_LENGTH = 200;
/** Shortest plausible university name. */
const MIN_NAME_LENGTH = 3;
/** ISO 3166-1 alpha-2 code length. */
const COUNTRY_CODE_LENGTH = 2;
/** The first number added to a slug that is already taken (§6.4: `-2`, `-3`…). */
const FIRST_SLUG_SUFFIX = 2;
/** Longest review note. */
const MAX_NOTE_LENGTH = 500;

const nameSchema = z.string().trim().min(MIN_NAME_LENGTH).max(MAX_NAME_LENGTH);
const countryCodeSchema = z
  .string()
  .trim()
  .length(COUNTRY_CODE_LENGTH)
  .transform((code) => code.toUpperCase());

export const universityRequestSchema = z.object({
  domain: z.string().trim().min(1).max(MAX_DOMAIN_LENGTH),
  proposedName: nameSchema,
  countryCode: countryCodeSchema,
});

export const requestReviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('create'), requestId: z.uuid(), name: nameSchema, countryCode: countryCodeSchema }),
  z.object({ decision: z.literal('attach'), requestId: z.uuid(), universityId: z.uuid() }),
  z.object({ decision: z.literal('reject'), requestId: z.uuid(), note: z.string().trim().max(MAX_NOTE_LENGTH).optional() }),
]);

export const moderatorChangeSchema = z.object({ login: z.string().trim().min(1), universityId: z.uuid(), grant: z.boolean() });

/**
 * "Request my university" (CLAUDE.md §8 F10 step 2): for a domain the list does not know. Disposable
 * domains and domains that already match a university are refused, and the country must be one
 * the university list has.
 */
export async function requestUniversity(userId: string, raw: unknown): Promise<{ requestId: string }> {
  const input = universityRequestSchema.parse(raw);
  const domain = normalizeDomain(input.domain.replace(/^.*@/, ''));
  if (domain === null) throw new ValidationError('universities.invalid_domain', 'Enter a domain like uni.edu.', { field: 'domain' });
  const suffixes = domainSuffixes(domain);
  if (await isDisposableDomain(suffixes)) {
    throw new ValidationError('universities.disposable', 'That is a throwaway email domain, not a university.', { field: 'domain' });
  }
  if ((await findUniversitiesByDomainSuffixes(suffixes)).length > 0) {
    throw new ValidationError('universities.domain_known', 'We already know this domain. Verify with your university email instead.', {
      field: 'domain',
    });
  }
  if ((await countryName(input.countryCode)) === null) {
    throw new ValidationError('universities.unknown_country', 'Pick a country from the list.', { field: 'countryCode' });
  }
  const request = await createUniversityRequest({ userId, domain, proposedName: input.proposedName, countryCode: input.countryCode });
  return { requestId: request.id };
}

type Reviewer = Pick<Member, 'id' | 'roles'>;

const isAdmin = (member: Reviewer) => hasRole(member, 'admin');
const moderatedUniversities = (member: Reviewer) =>
  member.roles.flatMap((role) => (role.role === 'uni_moderator' && role.universityId !== null ? [role.universityId] : []));

/** Countries a moderator reviews requests for: those of the universities they moderate. */
async function moderatedCountries(member: Reviewer): Promise<Set<string>> {
  const universities = await Promise.all(moderatedUniversities(member).map((id) => getUniversity(id)));
  return new Set(universities.flatMap((university) => (university ? [university.countryCode] : [])));
}

/**
 * Open requests a reviewer may act on: every one for an admin; for a moderator, those from the
 * countries of the universities they moderate (a new domain matches no known university, so the
 * country is what ties a request to a moderator).
 */
export async function listReviewableRequests(member: Reviewer): Promise<PendingRequest[]> {
  if (isAdmin(member)) return listPendingUniversityRequests(null);
  const countries = await moderatedCountries(member);
  const all = await listPendingUniversityRequests(null);
  return all.filter((request) => countries.has(request.countryCode));
}

/**
 * Reviews a request (CLAUDE.md §8 F10 step 6, §5.11). Admins may create a university, add the
 * domain to any university, or reject. Moderators may add the domain to a university they
 * moderate, or reject a request from its country; creating universities is for admins.
 */
export async function reviewRequest(member: Reviewer, raw: unknown, now: Date = new Date()) {
  const input = requestReviewSchema.parse(raw);
  const request = await getUniversityRequest(input.requestId);
  if (request?.status !== 'pending') throw new NotFoundError('universities.request_not_found', 'That request was already handled.');
  const admin = isAdmin(member);
  const notAllowed = new ForbiddenError('universities.review_forbidden', "You can't review that request.");

  if (input.decision === 'create') {
    if (!admin) throw notAllowed;
    const country = await countryName(input.countryCode);
    if (country === null) throw new ValidationError('universities.unknown_country', 'Pick a country from the list.', { field: 'countryCode' });
    const base = `${kebab(input.name) || kebab(request.domain)}-${input.countryCode.toLowerCase()}`;
    const taken = await slugsStartingWith(base);
    let slug = base;
    // Collisions get -2, -3… as in the Hipo sync (CLAUDE.md §6.4).
    for (let suffix = FIRST_SLUG_SUFFIX; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    return reviewUniversityRequest(input.requestId, member.id, { decision: 'create', name: input.name, countryCode: input.countryCode, country, slug }, null, now);
  }

  if (input.decision === 'attach') {
    if (!admin && !moderatedUniversities(member).includes(input.universityId)) throw notAllowed;
    const outcome = await reviewUniversityRequest(input.requestId, member.id, { decision: 'attach', universityId: input.universityId }, null, now);
    if (outcome.status === 'not_found') throw new NotFoundError('universities.not_found', 'That university does not exist.');
    return outcome;
  }

  if (!admin && !(await moderatedCountries(member)).has(request.countryCode)) throw notAllowed;
  return reviewUniversityRequest(input.requestId, member.id, { decision: 'reject' }, input.note ?? null, now);
}

/**
 * Grants or revokes the moderator role at a university (admins only, CLAUDE.md §5.11). A
 * moderator must be a verified member of the university they moderate.
 */
export async function changeModerator(admin: Reviewer, raw: unknown): Promise<{ changed: boolean }> {
  if (!isAdmin(admin)) throw new ForbiddenError('roles.forbidden', 'Only admins manage moderators.');
  const input = moderatorChangeSchema.parse(raw);
  const target = await findMemberByLogin(input.login.replace(/^@/, ''));
  if (!target) throw new ValidationError('roles.unknown_member', 'No member has that GitHub login.', { field: 'login' });
  if (input.grant && (target.verifiedAt === null || target.universityId !== input.universityId)) {
    throw new ValidationError('roles.not_verified_here', 'Moderators must be verified members of that university.', { field: 'login' });
  }
  return { changed: await setModeratorRole({ userId: target.userId, universityId: input.universityId, grant: input.grant }, admin.id) };
}

export function listModeratorGrants(): Promise<ModeratorRow[]> {
  return listModerators();
}
