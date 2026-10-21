import { percentileRank } from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  appendLedgerEntry,
  disputedReviewRequests,
  getDb,
  getReviewOf,
  getReviewRequest,
  getSetting,
  helpfulReviewCounts,
  insertNotification,
  insertVerifiedReview,
  lockLedger,
  lockReviewRequest,
  recordDispute,
  recordRating,
  reopenReviewRequest,
  reviewRequestsDue,
  writeAudit,
  type DisputedRequest,
  type Tx,
} from '@commitmates/db';
import {
  GitHubNotFoundError,
  SERVER_IDENTITY,
  fetchPullRequest,
  githubFor,
  listPullRequestReviewComments,
  listPullRequestReviews,
  type GitHubClient,
} from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { moderationScope } from '../admin/roles';
import type { Member } from '../profiles/schemas';
import { getMember, hasRole } from '../profiles/service';

import { REVIEW_COST, settleEscrow } from './ledger';
import { claimDeadline, closeWithRefund, requestIdSchema } from './requests';

const MS_PER_MINUTE = 60 * 1000; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Longest note a moderator can attach to a dispute decision (as for other moderation decisions). */
const MAX_RESOLUTION_NOTE = 500;
/** GitHub's state for a review that was started but never submitted. */
const PENDING_REVIEW = 'PENDING';

/** The reviewer's own token when valid; public reads otherwise go through the server token. */
async function clientFor(userId: string): Promise<GitHubClient> {
  const member = await getMember(userId);
  return githubFor(member?.hasValidToken ? { kind: 'user', userId } : SERVER_IDENTITY);
}

const verifyPayloadSchema = z.object({ requestId: z.uuid(), claimedAt: z.iso.datetime() });
type VerifyPayload = z.infer<typeof verifyPayloadSchema>;

/**
 * "I've submitted my review" (CLAUDE.md §8 F15 "Claim and verify" step 3): queues `verify_review`
 * for this claim. Asking twice for one claim queues it once.
 */
export async function markSubmitted(actor: Pick<Member, 'id'>, raw: unknown): Promise<string> {
  const { requestId } = requestIdSchema.parse(raw);
  const request = await getReviewRequest(requestId);
  if (request?.status !== 'claimed' || request.claimedBy !== actor.id || request.claimedAt === null) {
    throw new NotFoundError('reviews.not_claimed', 'You do not hold a claim on that request.');
  }
  const job = await enqueue(
    'verify_review',
    { requestId, claimedAt: request.claimedAt.toISOString() },
    // One verification per claim; it waits and checks again on its own until the claim runs out.
    { idempotencyKey: `review:${requestId}:${request.claimedAt.getTime()}`, priority: PRIORITY.USER_BG },
  );
  return job.id;
}

export type VerifyOutcome = 'verified' | 'not_yet' | 'claim_ended' | 'refunded' | 'stale';

/**
 * Checks GitHub for the claimer's review (§8 F15 "Claim and verify" step 3): a submitted review by
 * their login after the claim, and at least `reviews.minLineComments` line comments by them after
 * the claim. Verified → the review is stored and the author asked to rate it. A pull request that
 * vanished, or closed without such a review, ends the request with a refund. Otherwise the job
 * checks again every `reviews.verifyRetryMinutes` until the claim runs out, then frees the request.
 */
export async function verifyReview(payload: VerifyPayload, now: Date, deadline: number): Promise<{ outcome: VerifyOutcome; retryAt?: Date }> {
  const request = await getReviewRequest(payload.requestId);
  const claimedAt = new Date(payload.claimedAt);
  if (request?.status !== 'claimed' || request.claimedBy === null || request.claimedAt?.getTime() !== claimedAt.getTime()) return { outcome: 'stale' };
  const [minLineComments, claimTtlHours, retryMinutes] = await Promise.all([
    getSetting('reviews.minLineComments'),
    getSetting('reviews.claimTtlHours'),
    getSetting('reviews.verifyRetryMinutes'),
  ]);
  const reviewer = await getMember(request.claimedBy);
  const login = reviewer?.login?.toLowerCase() ?? null;
  const [owner = '', repo = ''] = request.repoFullName.split('/');
  const client = await clientFor(request.claimedBy);

  let found: { reviewIds: number[]; comments: number; open: boolean };
  try {
    const [pull, reviews, comments] = await Promise.all([
      fetchPullRequest(client, owner, repo, request.prNumber, { deadline }),
      listPullRequestReviews(client, owner, repo, request.prNumber, { deadline }),
      listPullRequestReviewComments(client, owner, repo, request.prNumber, { deadline }),
    ]);
    const after = (time: string | null) => time !== null && new Date(time).getTime() >= claimedAt.getTime();
    const mine = (author: string | null) => login !== null && author?.toLowerCase() === login;
    found = {
      reviewIds: reviews.filter((review) => mine(review.login) && review.state !== PENDING_REVIEW && after(review.submittedAt)).map((review) => review.id),
      comments: comments.filter((comment) => mine(comment.login) && after(comment.createdAt)).length,
      open: pull.state === 'open' && !pull.isPrivate,
    };
  } catch (error) {
    if (!(error instanceof GitHubNotFoundError)) throw error;
    await closeWithRefund(request.id, 'pull_missing');
    return { outcome: 'refunded' };
  }

  if (found.reviewIds.length > 0 && found.comments >= minLineComments) {
    const stored = await getDb().transaction(async (tx) => {
      const locked = await lockReviewRequest(request.id, tx);
      if (locked?.status !== 'claimed' || locked.claimedBy !== request.claimedBy) return false;
      await insertVerifiedReview(
        { requestId: request.id, reviewerUserId: request.claimedBy ?? '', ghReviewIds: found.reviewIds, lineCommentCount: found.comments, verifiedAt: now },
        tx,
      );
      return true;
    });
    if (!stored) return { outcome: 'stale' };
    await insertNotification(request.authorUserId, 'review_submitted', { requestId: request.id, login: reviewer?.login ?? '', repo: request.repoFullName, number: request.prNumber });
    return { outcome: 'verified' };
  }
  if (!found.open) {
    await closeWithRefund(request.id, 'pull_closed');
    return { outcome: 'refunded' };
  }
  const ends = claimDeadline(claimedAt, claimTtlHours);
  if (now >= ends) {
    if (await reopenReviewRequest(request.id, 'claimed', getDb())) {
      await insertNotification(request.claimedBy, 'review_claim_expired', { requestId: request.id, repo: request.repoFullName, number: request.prNumber });
    }
    return { outcome: 'claim_ended' };
  }
  const next = new Date(Math.min(now.getTime() + retryMinutes * MS_PER_MINUTE, ends.getTime()));
  return { outcome: 'not_yet', retryAt: next };
}

export const verifyReviewJob: JobHandler<VerifyPayload> = {
  type: 'verify_review',
  schema: verifyPayloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const result = await verifyReview(payload, ctx.now(), ctx.deadline);
    if (result.outcome === 'not_yet' && result.retryAt) return { kind: 'wait', until: result.retryAt, reason: 'dependency' };
    return { kind: 'done', resultRef: { outcome: result.outcome } };
  },
};

/** Settles a submitted review in the caller's transaction: helpful pays the reviewer, unhelpful refunds the author. */
async function settle(tx: Tx, request: { id: string; authorUserId: string }, reviewerId: string, rating: 'helpful' | 'unhelpful', now: Date, rated: boolean) {
  await settleEscrow(
    tx,
    rating === 'helpful'
      ? { authorId: request.authorUserId, requestId: request.id, outcome: 'release', reviewerId }
      : { authorId: request.authorUserId, requestId: request.id, outcome: 'refund' },
  );
  await recordRating(request.id, rated ? rating : null, rating === 'helpful' ? 'settled_helpful' : 'settled_unhelpful', now, tx);
}

export const rateReviewSchema = z.object({ requestId: z.uuid(), rating: z.enum(['helpful', 'unhelpful']) });

/** The author rates a verified review (§8 F15 "Rating and settlement"); the escrow settles with it. */
export async function rateReview(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<void> {
  const { requestId, rating } = rateReviewSchema.parse(raw);
  const reviewerId = await getDb().transaction(async (tx) => {
    const request = await lockReviewRequest(requestId, tx);
    if (request?.authorUserId !== actor.id) throw new NotFoundError('reviews.not_yours', 'That is not one of your review requests.');
    const review = await getReviewOf(requestId, tx);
    if (request.status !== 'submitted' || !review) throw new ValidationError('reviews.not_ratable', 'This review has already been settled.');
    await settle(tx, { id: requestId, authorUserId: actor.id }, review.reviewerUserId, rating, now, true);
    return review.reviewerUserId;
  });
  await insertNotification(reviewerId, 'review_rated', { requestId, rating });
}

export const disputeSchema = z.object({ requestId: z.uuid(), note: z.string().trim() });

/**
 * The reviewer disputes an unhelpful rating within `reviews.disputeWindowDays` (§8 F15 "disputes go
 * to /admin/moderation"). The author keeps their refund until a moderator decides.
 */
export async function disputeRating(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<void> {
  const input = disputeSchema.parse(raw);
  const [windowDays, maxNote] = await Promise.all([getSetting('reviews.disputeWindowDays'), getSetting('reviews.disputeNoteMaxChars')]);
  if (input.note.length === 0) throw new ValidationError('reviews.dispute_note', 'Say briefly why the review was helpful.', { field: 'note' });
  if (input.note.length > maxNote) throw new ValidationError('reviews.dispute_long', `Keep it under ${maxNote} characters.`, { field: 'note' });
  await getDb().transaction(async (tx) => {
    const request = await lockReviewRequest(input.requestId, tx);
    const review = request ? await getReviewOf(input.requestId, tx) : null;
    if (!request || review?.reviewerUserId !== actor.id) throw new NotFoundError('reviews.not_reviewer', 'You did not review that request.');
    if (request.status !== 'settled_unhelpful' || review.ratedAt === null) throw new ValidationError('reviews.not_disputable', 'Only an unhelpful rating can be disputed.');
    if (now.getTime() - review.ratedAt.getTime() > windowDays * MS_PER_DAY) {
      throw new ValidationError('reviews.dispute_late', `Ratings can be disputed for ${windowDays} days.`);
    }
    await recordDispute(input.requestId, actor.id, input.note, now, tx);
  });
}

/** Disputes the actor may decide: all for admins, their universities' for moderators. */
export async function listDisputes(actor: Pick<Member, 'id' | 'roles'>): Promise<DisputedRequest[]> {
  const scope = await moderationScope(actor);
  return disputedReviewRequests(scope.admin ? null : scope.universities.map((university) => university.id));
}

export const resolveDisputeSchema = z.object({
  requestId: z.uuid(),
  outcome: z.enum(['reviewer', 'author']),
  note: z.string().trim().max(MAX_RESOLUTION_NOTE).default(''),
});

/**
 * A moderator decides a dispute (§8 F15, §5.10): for the reviewer, they receive the credit as an
 * audited `admin_adjust` (the author's refund stands, so nobody is charged twice) and the request
 * settles as helpful; for the author, it stays settled as unhelpful. Both are told; the decision is audited.
 */
export async function resolveDispute(actor: Pick<Member, 'id' | 'roles'>, raw: unknown): Promise<void> {
  const input = resolveDisputeSchema.parse(raw);
  const request = await getReviewRequest(input.requestId);
  if (request?.status !== 'disputed') throw new NotFoundError('reviews.not_disputed', 'That dispute has already been decided.');
  if (!hasRole(actor, 'admin') && !hasRole(actor, { role: 'uni_moderator', universityId: request.universityId })) {
    throw new ForbiddenError('moderation.out_of_scope', 'That request is not at a university you moderate.');
  }
  const reviewerId = await getDb().transaction(async (tx) => {
    const locked = await lockReviewRequest(input.requestId, tx);
    const review = await getReviewOf(input.requestId, tx);
    if (locked?.status !== 'disputed' || !review) throw new NotFoundError('reviews.not_disputed', 'That dispute has already been decided.');
    if (input.outcome === 'reviewer') {
      await lockLedger(review.reviewerUserId, tx);
      await appendLedgerEntry({ userId: review.reviewerUserId, delta: REVIEW_COST, reason: 'admin_adjust', requestId: input.requestId }, tx);
      await recordRating(input.requestId, null, 'settled_helpful', new Date(), tx);
    } else {
      await recordRating(input.requestId, null, 'settled_unhelpful', new Date(), tx);
    }
    await writeAudit(
      { actorUserId: actor.id, action: 'reviews.dispute_resolved', targetType: 'review_request', targetId: input.requestId, data: { outcome: input.outcome, note: input.note } },
      tx,
    );
    return review.reviewerUserId;
  });
  for (const userId of [reviewerId, request.authorUserId]) {
    await insertNotification(userId, 'review_dispute_resolved', { requestId: input.requestId, outcome: input.outcome, role: userId === reviewerId ? 'reviewer' : 'author' });
  }
}

/**
 * Hourly upkeep (`expire_reviews`, CLAUDE.md §5.4): claims past `reviews.claimTtlHours` (or whose
 * reviewer left) go back to open; open requests past their lifetime end with a refund; verified
 * reviews nobody rated within `reviews.autoSettleDays` settle as helpful; a submitted request whose
 * reviewer deleted their account opens again.
 */
export async function expireReviews(now: Date): Promise<{ claimsEnded: number; expired: number; autoSettled: number; reopened: number }> {
  const [claimTtlHours, autoSettleDays] = await Promise.all([getSetting('reviews.claimTtlHours'), getSetting('reviews.autoSettleDays')]);
  const due = await reviewRequestsDue(now, { claimTtlHours, autoSettleDays });
  let claimsEnded = 0;
  for (const id of due.claimsEnded) {
    const request = await getReviewRequest(id);
    if (!(await reopenReviewRequest(id, 'claimed', getDb()))) continue;
    claimsEnded += 1;
    if (request?.claimedBy) await insertNotification(request.claimedBy, 'review_claim_expired', { requestId: id, repo: request.repoFullName, number: request.prNumber });
  }
  let expired = 0;
  for (const id of due.openExpired) if (await closeWithRefund(id, 'expired')) expired += 1;
  let autoSettled = 0;
  for (const id of due.autoSettle) {
    const reviewerId = await getDb().transaction(async (tx) => {
      const request = await lockReviewRequest(id, tx);
      const review = await getReviewOf(id, tx);
      if (request?.status !== 'submitted' || review?.rating !== null) return null;
      await settle(tx, { id, authorUserId: request.authorUserId }, review.reviewerUserId, 'helpful', now, false);
      return review.reviewerUserId;
    });
    if (reviewerId === null) continue;
    autoSettled += 1;
    await insertNotification(reviewerId, 'review_rated', { requestId: id, rating: 'helpful', automatic: true });
  }
  let reopened = 0;
  for (const id of due.orphaned) if (await reopenReviewRequest(id, 'submitted', getDb())) reopened += 1;
  return { claimsEnded, expired, autoSettled, reopened };
}

const emptyPayload = z.object({});

export const expireReviewsJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'expire_reviews',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    return { kind: 'done', resultRef: await expireReviews(ctx.now()) };
  },
};

export type ReviewReputation = { helpful: number; percentile: number | null; tier: number };

/**
 * Review reputation (§8 F15 "Reputation"): the member's helpful reviews as a percentile among the
 * verified members of their university, and the tier it reaches in `reviews.reputationTierCuts`.
 * Members without a helpful review have no percentile and tier 0.
 */
export async function reviewReputation(userId: string, universityId: string): Promise<ReviewReputation> {
  const [counts, cuts] = await Promise.all([helpfulReviewCounts(universityId), getSetting('reviews.reputationTierCuts')]);
  const helpful = counts.get(userId) ?? 0;
  if (helpful === 0) return { helpful, percentile: null, tier: 0 };
  const percentile = percentileRank([...counts.values()], helpful);
  return { helpful, percentile, tier: cuts.filter((cut) => percentile >= cut).length };
}
