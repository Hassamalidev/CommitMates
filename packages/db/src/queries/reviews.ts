import { and, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { reviewRequests, reviews } from '../schema';

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
  review: { lineComments: number; verifiedAt: Date; rating: 'helpful' | 'unhelpful' | null; ratedAt: Date | null } | null;
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
  rated_at: string | null;
};

const requestColumns = sql`
  rr.id, rr.author_user_id, author.login as author_login, rr.university_id, rr.pr_url, rr.repo_full_name, rr.pr_number,
  rr.languages, rr.status, rr.claimed_by, claimer.login as claimer_login, rr.claimed_at, rr.expires_at, rr.created_at,
  rv.line_comment_count, rv.verified_at, rv.rating, rv.rated_at`;
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
      : {
          lineComments: row.line_comment_count ?? 0,
          verifiedAt: new Date(row.verified_at),
          rating: row.rating,
          ratedAt: row.rated_at === null ? null : new Date(row.rated_at),
        },
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

/** Records the review GitHub showed for a claim and moves the request to `submitted`. */
export async function insertVerifiedReview(
  review: { requestId: string; reviewerUserId: string; ghReviewIds: number[]; lineCommentCount: number; verifiedAt: Date },
  tx: Tx,
): Promise<void> {
  await tx.insert(reviews).values(review).onConflictDoNothing();
  await tx.update(reviewRequests).set({ status: 'submitted' }).where(eq(reviewRequests.id, review.requestId));
}

export type ReviewRecord = { reviewerUserId: string; rating: 'helpful' | 'unhelpful' | null; ratedAt: Date | null; verifiedAt: Date };

/** The verified review of a request, if any. */
export async function getReviewOf(requestId: string, db: DbOrTx = getDb()): Promise<ReviewRecord | null> {
  const [row] = await db
    .select({ reviewerUserId: reviews.reviewerUserId, rating: reviews.rating, ratedAt: reviews.ratedAt, verifiedAt: reviews.verifiedAt })
    .from(reviews)
    .where(eq(reviews.requestId, requestId));
  return row ?? null;
}

/** Records the author's rating and the request's settled status. */
export async function recordRating(requestId: string, rating: 'helpful' | 'unhelpful' | null, status: ReviewRequestStatus, now: Date, tx: Tx): Promise<void> {
  if (rating !== null) await tx.update(reviews).set({ rating, ratedAt: now }).where(eq(reviews.requestId, requestId));
  await tx.update(reviewRequests).set({ status }).where(eq(reviewRequests.id, requestId));
}

/** Marks a request disputed by its reviewer, with their note. */
export async function recordDispute(requestId: string, reviewerId: string, note: string, now: Date, tx: Tx): Promise<void> {
  await tx.update(reviewRequests).set({ status: 'disputed', disputedBy: reviewerId, disputeNote: note, disputedAt: now }).where(eq(reviewRequests.id, requestId));
}

/** Ids of requests the hourly `expire_reviews` run has to act on (CLAUDE.md §8 F15). */
export async function reviewRequestsDue(
  now: Date,
  rules: { claimTtlHours: number; autoSettleDays: number },
  db: DbOrTx = getDb(),
): Promise<{ claimsEnded: string[]; openExpired: string[]; autoSettle: string[]; orphaned: string[] }> {
  const at = now.toISOString();
  const [claims, open, settle, orphaned] = await Promise.all([
    db.execute<{ id: string }>(sql`
      select id from review_requests
      where status = 'claimed' and (claimed_by is null or claimed_at + make_interval(hours => ${rules.claimTtlHours}) <= ${at}::timestamptz)`),
    db.execute<{ id: string }>(sql`select id from review_requests where status = 'open' and expires_at <= ${at}::timestamptz`),
    db.execute<{ id: string }>(sql`
      select rr.id from review_requests rr join reviews rv on rv.request_id = rr.id
      where rr.status = 'submitted' and rv.rating is null and rv.verified_at + make_interval(days => ${rules.autoSettleDays}) <= ${at}::timestamptz`),
    // A reviewer who deleted their account takes their review with them; the request waits for someone else.
    db.execute<{ id: string }>(sql`
      select rr.id from review_requests rr
      where rr.status = 'submitted' and not exists (select 1 from reviews rv where rv.request_id = rr.id)`),
  ]);
  return { claimsEnded: claims.map((row) => row.id), openExpired: open.map((row) => row.id), autoSettle: settle.map((row) => row.id), orphaned: orphaned.map((row) => row.id) };
}

/** Puts a request back to open with no claim, from `claimed` or an orphaned `submitted`. */
export async function reopenReviewRequest(requestId: string, from: ReviewRequestStatus, tx: DbOrTx): Promise<boolean> {
  const rows = await tx
    .update(reviewRequests)
    .set({ status: 'open', claimedBy: null, claimedAt: null })
    .where(and(eq(reviewRequests.id, requestId), eq(reviewRequests.status, from)))
    .returning({ id: reviewRequests.id });
  return rows.length > 0;
}

export type DisputedRequest = ReviewRequestRow & { disputeNote: string | null; disputedAt: Date | null; reviewerUserId: string | null };

/** Disputed requests, oldest first; only those at the given universities unless `universityIds` is null. */
export async function disputedReviewRequests(universityIds: readonly string[] | null, db: DbOrTx = getDb()): Promise<DisputedRequest[]> {
  if (universityIds?.length === 0) return [];
  const scope =
    universityIds === null
      ? sql``
      : sql`and rr.university_id in (${sql.join(
          universityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await db.execute<RawRequest & { dispute_note: string | null; disputed_at: string | null; reviewer_user_id: string | null }>(sql`
    select ${requestColumns}, rr.dispute_note, rr.disputed_at, rv.reviewer_user_id
    from review_requests rr ${requestJoins}
    where rr.status = 'disputed' ${scope}
    order by rr.disputed_at`);
  return rows.map((row) => ({
    ...toRequest(row),
    disputeNote: row.dispute_note,
    disputedAt: row.disputed_at === null ? null : new Date(row.disputed_at),
    reviewerUserId: row.reviewer_user_id,
  }));
}

/** Helpful reviews of each verified member at a university, members without any included as 0. */
export async function helpfulReviewCounts(universityId: string, db: DbOrTx = getDb()): Promise<Map<string, number>> {
  const rows = await db.execute<{ user_id: string; helpful: number }>(sql`
    select p.user_id, count(rr.id)::int as helpful
    from profiles p
    left join reviews rv on rv.reviewer_user_id = p.user_id
    left join review_requests rr on rr.id = rv.request_id and rr.status = 'settled_helpful'
    where p.university_id = ${universityId} and p.verified_at is not null
    group by p.user_id`);
  return new Map(rows.map((row) => [row.user_id, row.helpful]));
}
