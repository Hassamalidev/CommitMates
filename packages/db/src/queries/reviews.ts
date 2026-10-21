import { and, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { reviewRequests } from '../schema';

export type ReviewRequestStatus = 'open' | 'claimed' | 'submitted' | 'settled_helpful' | 'settled_unhelpful' | 'expired' | 'disputed';

/** Statuses in which a request is still waiting on someone. */
export const LIVE_REVIEW_STATUSES: readonly ReviewRequestStatus[] = ['open', 'claimed', 'submitted', 'disputed'];

/** File extensions of Linguist languages, each with every language that uses it (CLAUDE.md §6.3). */
export async function languagesForExtensions(extensions: readonly string[], db: DbOrTx = getDb()): Promise<Map<string, string[]>> {
  const wanted = [...new Set(extensions.map((ext) => ext.toLowerCase()))];
  if (wanted.length === 0) return new Map();
  const rows = await db.execute<{ ext: string; name: string }>(sql`
    select lower(ext) as ext, l.name from languages l, unnest(l.extensions) as ext
    where lower(ext) in (${sql.join(
      wanted.map((ext) => sql`${ext}`),
      sql`, `,
    )})
    order by l.name`);
  const byExt = new Map<string, string[]>();
  for (const row of rows) byExt.set(row.ext, [...(byExt.get(row.ext) ?? []), row.name]);
  return byExt;
}

/** Whether a pull request already has a request that is not finished. */
export async function hasLiveReviewRequest(repoFullName: string, prNumber: number, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    select id from review_requests
    where repo_full_name = ${repoFullName} and pr_number = ${prNumber} and status in ('open', 'claimed', 'submitted', 'disputed')
    limit 1`);
  return rows.length > 0;
}

export async function insertReviewRequest(
  request: { authorUserId: string; universityId: string; prUrl: string; repoFullName: string; prNumber: number; languages: string[]; expiresAt: Date },
  tx: Tx,
): Promise<string> {
  const [row] = await tx.insert(reviewRequests).values(request).returning({ id: reviewRequests.id });
  if (!row) throw new Error('review request insert returned no row');
  return row.id;
}

export type ReviewRequestRow = {
  id: string;
  authorUserId: string;
  authorLogin: string | null;
  universityId: string;
  prUrl: string;
  repoFullName: string;
  prNumber: number;
  languages: string[];
  status: ReviewRequestStatus;
  claimedBy: string | null;
  claimerLogin: string | null;
  claimedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  /** The verified review, once there is one. */
  review: { lineComments: number; verifiedAt: Date; rating: 'helpful' | 'unhelpful' | null } | null;
};

type RawRequest = {
  id: string;
  author_user_id: string;
  author_login: string | null;
  university_id: string;
  pr_url: string;
  repo_full_name: string;
  pr_number: number;
  languages: string[];
  status: ReviewRequestStatus;
  claimed_by: string | null;
  claimer_login: string | null;
  claimed_at: string | null;
  expires_at: string;
  created_at: string;
  line_comment_count: number | null;
  verified_at: string | null;
  rating: 'helpful' | 'unhelpful' | null;
};

const requestColumns = sql`
  rr.id, rr.author_user_id, author.login as author_login, rr.university_id, rr.pr_url, rr.repo_full_name, rr.pr_number,
  rr.languages, rr.status, rr.claimed_by, claimer.login as claimer_login, rr.claimed_at, rr.expires_at, rr.created_at,
  rv.line_comment_count, rv.verified_at, rv.rating`;
const requestJoins = sql`
  left join github_identities author on author.user_id = rr.author_user_id
  left join github_identities claimer on claimer.user_id = rr.claimed_by
  left join reviews rv on rv.request_id = rr.id`;

const toRequest = (row: RawRequest): ReviewRequestRow => ({
  id: row.id,
  authorUserId: row.author_user_id,
  authorLogin: row.author_login,
  universityId: row.university_id,
  prUrl: row.pr_url,
  repoFullName: row.repo_full_name,
  prNumber: row.pr_number,
  languages: row.languages,
  status: row.status,
  claimedBy: row.claimed_by,
  claimerLogin: row.claimer_login,
  claimedAt: row.claimed_at === null ? null : new Date(row.claimed_at),
  expiresAt: new Date(row.expires_at),
  createdAt: new Date(row.created_at),
  review:
    row.verified_at === null
      ? null
      : { lineComments: row.line_comment_count ?? 0, verifiedAt: new Date(row.verified_at), rating: row.rating },
});

/** One request with its author, claimer and verified review. */
export async function getReviewRequest(requestId: string, db: DbOrTx = getDb()): Promise<ReviewRequestRow | null> {
  const rows = await db.execute<RawRequest>(sql`select ${requestColumns} from review_requests rr ${requestJoins} where rr.id = ${requestId}`);
  const row = rows[0];
  return row ? toRequest(row) : null;
}

/**
 * Open requests at a university that this member could claim (CLAUDE.md §8 F15 "Claim and verify"):
 * not their own, not expired, from active members, and with no block either way. Newest first; the
 * caller sorts by language overlap.
 */
export async function claimableReviewRequests(universityId: string, viewerId: string, limit: number, db: DbOrTx = getDb()): Promise<ReviewRequestRow[]> {
  const rows = await db.execute<RawRequest>(sql`
    select ${requestColumns} from review_requests rr ${requestJoins}
    join users u on u.id = rr.author_user_id
    where rr.university_id = ${universityId} and rr.status = 'open' and rr.expires_at > now()
      and rr.author_user_id <> ${viewerId} and u.status = 'active'
      and not exists (select 1 from blocks b where (b.blocker = ${viewerId} and b.blocked = rr.author_user_id)
                                              or (b.blocker = rr.author_user_id and b.blocked = ${viewerId}))
    order by rr.created_at desc
    limit ${limit}`);
  return rows.map(toRequest);
}

/** A member's own requests, newest first. */
export async function authoredReviewRequests(authorId: string, limit: number, db: DbOrTx = getDb()): Promise<ReviewRequestRow[]> {
  const rows = await db.execute<RawRequest>(sql`
    select ${requestColumns} from review_requests rr ${requestJoins}
    where rr.author_user_id = ${authorId} order by rr.created_at desc limit ${limit}`);
  return rows.map(toRequest);
}

/** Requests a member claimed that are not finished, plus their finished reviews, newest first. */
export async function claimedReviewRequests(reviewerId: string, limit: number, db: DbOrTx = getDb()): Promise<ReviewRequestRow[]> {
  const rows = await db.execute<RawRequest>(sql`
    select ${requestColumns} from review_requests rr ${requestJoins}
    where rr.claimed_by = ${reviewerId} or rv.reviewer_user_id = ${reviewerId}
    order by coalesce(rr.claimed_at, rr.created_at) desc limit ${limit}`);
  return rows.map(toRequest);
}

/**
 * Claims an open request (§8 F15 step 2) in one statement, so two reviewers cannot both claim it.
 * False when it is no longer open, has expired, or is the reviewer's own.
 */
export async function claimReviewRequest(requestId: string, reviewerId: string, now: Date, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(reviewRequests)
    .set({ status: 'claimed', claimedBy: reviewerId, claimedAt: now })
    .where(
      and(
        eq(reviewRequests.id, requestId),
        eq(reviewRequests.status, 'open'),
        sql`${reviewRequests.expiresAt} > ${now.toISOString()}::timestamptz`,
        sql`${reviewRequests.authorUserId} <> ${reviewerId}`,
      ),
    )
    .returning({ id: reviewRequests.id });
  return rows.length > 0;
}

/** Gives a claim back: the request is open again. False when this reviewer does not hold the claim. */
export async function releaseReviewClaim(requestId: string, reviewerId: string | null, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(reviewRequests)
    .set({ status: 'open', claimedBy: null, claimedAt: null })
    .where(
      and(
        eq(reviewRequests.id, requestId),
        eq(reviewRequests.status, 'claimed'),
        reviewerId === null ? sql`${reviewRequests.claimedBy} is null` : eq(reviewRequests.claimedBy, reviewerId),
      ),
    )
    .returning({ id: reviewRequests.id });
  return rows.length > 0;
}

/**
 * Locks a request for a status change inside a transaction; the row as it stands under the lock.
 */
export async function lockReviewRequest(requestId: string, tx: Tx): Promise<{ status: ReviewRequestStatus; authorUserId: string; claimedBy: string | null } | null> {
  const [row] = await tx
    .select({ status: reviewRequests.status, authorUserId: reviewRequests.authorUserId, claimedBy: reviewRequests.claimedBy })
    .from(reviewRequests)
    .where(eq(reviewRequests.id, requestId))
    .for('update');
  return row ?? null;
}

export async function setReviewRequestStatus(requestId: string, status: ReviewRequestStatus, tx: DbOrTx): Promise<void> {
  await tx.update(reviewRequests).set({ status }).where(eq(reviewRequests.id, requestId));
}
