import { and, asc, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { githubIdentities, notifications, profiles, roles, universities, universityDomains, universityRequests } from '../schema';

import { writeAudit } from './admin';

export type Country = { code: string; name: string };

/** Countries that have universities in the list, for pickers. Nothing is hand-listed (CLAUDE.md §2.3). */
export async function listCountries(db: DbOrTx = getDb()): Promise<Country[]> {
  const rows = await db
    .selectDistinct({ code: universities.countryCode, name: universities.country })
    .from(universities)
    .orderBy(asc(universities.country));
  // A code appears once even when the list spells its country two ways.
  const byCode = new Map<string, Country>();
  for (const row of rows) if (!byCode.has(row.code)) byCode.set(row.code, row);
  return [...byCode.values()];
}

/** The country name for a code, from the university list; `null` when no university has it. */
export async function countryName(code: string, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.select({ name: universities.country }).from(universities).where(eq(universities.countryCode, code)).limit(1);
  return row?.name ?? null;
}

export type NewUniversityRequest = { userId: string; domain: string; proposedName: string; countryCode: string };

/** Records a request, or returns the member's open request for the same domain. */
export async function createUniversityRequest(input: NewUniversityRequest, db: DbOrTx = getDb()): Promise<{ id: string; created: boolean }> {
  const [created] = await db.insert(universityRequests).values(input).onConflictDoNothing().returning({ id: universityRequests.id });
  if (created) return { id: created.id, created: true };
  const [existing] = await db
    .select({ id: universityRequests.id })
    .from(universityRequests)
    .where(and(eq(universityRequests.userId, input.userId), eq(universityRequests.domain, input.domain), eq(universityRequests.status, 'pending')));
  if (!existing) throw new Error('university request was neither created nor found');
  return { id: existing.id, created: false };
}

export type PendingRequest = {
  id: string;
  domain: string;
  proposedName: string;
  countryCode: string;
  requesterLogin: string | null;
  createdAt: Date;
};

/** Open requests, oldest first; optionally only those from one country (a moderator's view). */
export async function listPendingUniversityRequests(countryCode: string | null, db: DbOrTx = getDb()): Promise<PendingRequest[]> {
  return db
    .select({
      id: universityRequests.id,
      domain: universityRequests.domain,
      proposedName: universityRequests.proposedName,
      countryCode: universityRequests.countryCode,
      requesterLogin: githubIdentities.login,
      createdAt: universityRequests.createdAt,
    })
    .from(universityRequests)
    .leftJoin(githubIdentities, eq(githubIdentities.userId, universityRequests.userId))
    .where(
      countryCode === null
        ? eq(universityRequests.status, 'pending')
        : and(eq(universityRequests.status, 'pending'), eq(universityRequests.countryCode, countryCode)),
    )
    .orderBy(asc(universityRequests.createdAt));
}

/** One request with its state, for permission checks before a review. */
export async function getUniversityRequest(id: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select({ id: universityRequests.id, domain: universityRequests.domain, countryCode: universityRequests.countryCode, status: universityRequests.status })
    .from(universityRequests)
    .where(eq(universityRequests.id, id));
  return row ?? null;
}

/** The member's most recent request, to show its state during onboarding. */
export async function latestUniversityRequest(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select({ domain: universityRequests.domain, status: universityRequests.status, note: universityRequests.note })
    .from(universityRequests)
    .where(eq(universityRequests.userId, userId))
    .orderBy(sql`${universityRequests.createdAt} desc`)
    .limit(1);
  return row ?? null;
}

export type RequestReview =
  | { decision: 'create'; name: string; countryCode: string; country: string; slug: string }
  | { decision: 'attach'; universityId: string }
  | { decision: 'reject' };

export type ReviewOutcome = { status: 'not_found' } | { status: 'reviewed'; universityId: string | null; universityName: string | null };

/**
 * Reviews an open request in one transaction (CLAUDE.md §8 F10 step 6): creates a university
 * (`source = 'admin'`) or adds the domain to an existing one, or rejects; records who
 * reviewed it; notifies the requester; writes the audit log. Permission is checked by the caller.
 */
export async function reviewUniversityRequest(
  requestId: string,
  reviewerId: string,
  review: RequestReview,
  note: string | null,
  now: Date,
  db: DbOrTx = getDb(),
): Promise<ReviewOutcome> {
  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const [request] = await tx
      .select()
      .from(universityRequests)
      .where(and(eq(universityRequests.id, requestId), eq(universityRequests.status, 'pending')))
      .for('update');
    if (!request) return { status: 'not_found' };

    let university: { id: string; name: string } | null = null;
    if (review.decision === 'create') {
      const [created] = await tx
        .insert(universities)
        .values({
          name: review.name,
          slug: review.slug,
          country: review.country,
          countryCode: review.countryCode,
          webPages: [],
          source: 'admin',
          checksum: 'admin',
        })
        .returning({ id: universities.id, name: universities.name });
      university = created ?? null;
    } else if (review.decision === 'attach') {
      const [found] = await tx.select({ id: universities.id, name: universities.name }).from(universities).where(eq(universities.id, review.universityId));
      university = found ?? null;
      if (!university) return { status: 'not_found' };
    }
    if (university) {
      await tx.insert(universityDomains).values({ domain: request.domain, universityId: university.id }).onConflictDoNothing();
    }

    const approved = review.decision !== 'reject';
    await tx
      .update(universityRequests)
      .set({ status: approved ? 'approved' : 'rejected', reviewedBy: reviewerId, reviewedAt: now, universityId: university?.id ?? null, note })
      .where(eq(universityRequests.id, requestId));
    await tx.insert(notifications).values({
      userId: request.userId,
      kind: approved ? 'university_request_approved' : 'university_request_rejected',
      data: { domain: request.domain, universityName: university?.name ?? null, note },
    });
    await writeAudit(
      {
        actorUserId: reviewerId,
        action: approved ? `university_request.${review.decision}` : 'university_request.reject',
        targetType: 'university_request',
        targetId: requestId,
        data: { domain: request.domain, universityId: university?.id ?? null },
      },
      tx,
    );
    return { status: 'reviewed', universityId: university?.id ?? null, universityName: university?.name ?? null };
  });
}

/** Slugs already taken that start with `base`, to pick the next free `-2`, `-3`… */
export async function slugsStartingWith(base: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ slug: universities.slug })
    .from(universities)
    .where(sql`${universities.slug} = ${base} or ${universities.slug} like ${`${base}-%`}`);
  return new Set(rows.map((row) => row.slug));
}

export type ModeratorRow = { userId: string; login: string | null; universityId: string; universityName: string; grantedAt: Date };

/** Every moderator grant with the member's login and university. */
export async function listModerators(db: DbOrTx = getDb()): Promise<ModeratorRow[]> {
  const rows = await db
    .select({
      userId: roles.userId,
      login: githubIdentities.login,
      universityId: roles.universityId,
      universityName: universities.name,
      grantedAt: roles.grantedAt,
    })
    .from(roles)
    .innerJoin(universities, eq(universities.id, roles.universityId))
    .leftJoin(githubIdentities, eq(githubIdentities.userId, roles.userId))
    .where(eq(roles.role, 'uni_moderator'))
    .orderBy(asc(universities.name), asc(githubIdentities.login));
  return rows.flatMap((row) => (row.universityId === null ? [] : [{ ...row, universityId: row.universityId }]));
}

/** A member by GitHub login with where they are verified, for granting roles. */
export async function findMemberByLogin(login: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select({ userId: githubIdentities.userId, login: githubIdentities.login, universityId: profiles.universityId, verifiedAt: profiles.verifiedAt })
    .from(githubIdentities)
    .innerJoin(profiles, eq(profiles.userId, githubIdentities.userId))
    .where(eq(githubIdentities.login, login));
  return row ?? null;
}

/** Grants or revokes a moderator role, with an audit entry; returns false when nothing changed. */
export async function setModeratorRole(
  change: { userId: string; universityId: string; grant: boolean },
  actorUserId: string,
  db: DbOrTx = getDb(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const changed = change.grant
      ? await tx
          .insert(roles)
          .values({ userId: change.userId, role: 'uni_moderator', universityId: change.universityId, grantedBy: actorUserId })
          .onConflictDoNothing()
          .returning({ userId: roles.userId })
      : await tx
          .delete(roles)
          .where(and(eq(roles.userId, change.userId), eq(roles.role, 'uni_moderator'), eq(roles.universityId, change.universityId)))
          .returning({ userId: roles.userId });
    if (changed.length === 0) return false;
    await writeAudit(
      {
        actorUserId,
        action: change.grant ? 'role.grant' : 'role.revoke',
        targetType: 'user',
        targetId: change.userId,
        data: { role: 'uni_moderator', universityId: change.universityId },
      },
      tx,
    );
    return true;
  });
}
