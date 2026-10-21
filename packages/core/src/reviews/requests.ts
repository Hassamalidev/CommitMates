import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authoredReviewRequests,
  claimReviewRequest,
  claimableReviewRequests,
  claimedReviewRequests,
  getDb,
  getReviewRequest,
  getSetting,
  getSkillVector,
  hasLiveReviewRequest,
  insertNotification,
  insertReviewRequest,
  isBlockedEitherWay,
  languagesForExtensions,
  lockReviewRequest,
  releaseReviewClaim,
  setReviewRequestStatus,
  type ReviewRequestRow,
} from '@commitmates/db';
import { GitHubNotFoundError, SERVER_IDENTITY, fetchPullRequest, githubFor, listPullRequestFiles, parseGitHubUrl, type GitHubClient, type PullRequest } from '@commitmates/github';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';
import { campusUnlocks } from '../universities/campus';

import { escrowCredit, getCredits, settleEscrow, type CreditOverview } from './ledger';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion

type Actor = Pick<Member, 'id' | 'login' | 'verified' | 'universityId' | 'hasValidToken'>;

/** A verified member at a university where the Review Exchange is open (`unlock.reviews.minMembers`). */
async function requireReviewsOpen(actor: Actor): Promise<string> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('reviews.verify_first', 'Verify your university to use the Review Exchange.');
  const { unlocks } = await campusUnlocks(actor.universityId);
  if (!unlocks.find((unlock) => unlock.key === 'reviews')?.unlocked) {
    throw new ForbiddenError('reviews.locked', 'The Review Exchange opens once enough members of your university have joined.');
  }
  return actor.universityId;
}

/** The member's own token for their own pull requests; the server token for public reads otherwise. */
const clientFor = (actor: Pick<Member, 'id' | 'hasValidToken'>): GitHubClient => githubFor(actor.hasValidToken ? { kind: 'user', userId: actor.id } : SERVER_IDENTITY);

/** File extension of a path as Linguist lists it (`.ts`), or null for files without one. */
export function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : null;
}

/**
 * Languages of a pull request's changed files (§8 F15 "Request" step 2): extensions looked up in the
 * Linguist languages, ranked by how many files use each, at most `limit`. An extension several
 * languages share counts for each of them.
 */
export async function pullRequestLanguages(paths: readonly string[], limit: number): Promise<string[]> {
  const extensions = paths.map(extensionOf).filter((ext): ext is string => ext !== null);
  const byExt = await languagesForExtensions(extensions);
  const files = new Map<string, number>();
  for (const ext of extensions) for (const name of byExt.get(ext) ?? []) files.set(name, (files.get(name) ?? 0) + 1);
  return [...files.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * Whether the member may ask for a review of this pull request (§8 F15 "Request" step 1): they opened
 * it, or they own its repository. Organization membership and collaborator status of someone other
 * than the pull request's author cannot be read without scopes we never ask for (§2.7).
 */
export function mayRequestReview(pull: Pick<PullRequest, 'authorLogin' | 'repoOwnerLogin'>, login: string): boolean {
  const own = login.toLowerCase();
  return pull.authorLogin?.toLowerCase() === own || pull.repoOwnerLogin.toLowerCase() === own;
}

export const createReviewRequestSchema = z.object({ prUrl: z.string().trim().min(1, 'Paste the link to your pull request.') });

/**
 * Offers a pull request for review (CLAUDE.md §8 F15 "Request"): a public, open pull request the
 * member wrote or owns the repository of; its languages; one credit held in escrow, in the same
 * transaction as the request. One live request per pull request.
 */
export async function createReviewRequest(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const universityId = await requireReviewsOpen(actor);
  const { prUrl } = createReviewRequestSchema.parse(raw);
  const ref = parseGitHubUrl(prUrl);
  if (ref?.number === undefined) throw new ValidationError('reviews.not_a_pull', 'Paste a link to a pull request, like github.com/owner/repo/pull/12.', { field: 'prUrl' });
  const client = clientFor(actor);
  let pull: PullRequest;
  try {
    pull = await fetchPullRequest(client, ref.owner, ref.repo, ref.number);
  } catch (error) {
    if (error instanceof GitHubNotFoundError) throw new ValidationError('reviews.pull_missing', 'We could not find that pull request. Is the repository public?', { field: 'prUrl' });
    throw error;
  }
  if (pull.isPrivate) throw new ValidationError('reviews.pull_private', 'Only pull requests in public repositories can be reviewed here.', { field: 'prUrl' });
  if (pull.state !== 'open') throw new ValidationError('reviews.pull_closed', 'That pull request is closed. Ask for a review while it is open.', { field: 'prUrl' });
  if (actor.login === null || !mayRequestReview(pull, actor.login)) {
    throw new ValidationError('reviews.pull_not_yours', 'Ask for reviews of pull requests you opened, or in repositories you own.', { field: 'prUrl' });
  }
  if (await hasLiveReviewRequest(pull.repoFullName, pull.number)) {
    throw new ConflictError('reviews.duplicate', 'That pull request is already waiting for a review.');
  }

  const [maxLanguages, ttlDays] = await Promise.all([getSetting('reviews.maxLanguages'), getSetting('reviews.requestTtlDays')]);
  const { paths } = await listPullRequestFiles(client, ref.owner, ref.repo, pull.number);
  const languages = await pullRequestLanguages(paths, maxLanguages);
  return getDb().transaction(async (tx) => {
    const id = await insertReviewRequest(
      {
        authorUserId: actor.id,
        universityId,
        prUrl: pull.htmlUrl ?? `https://github.com/${pull.repoFullName}/pull/${pull.number}`,
        repoFullName: pull.repoFullName,
        prNumber: pull.number,
        languages,
        expiresAt: new Date(now.getTime() + ttlDays * MS_PER_DAY),
      },
      tx,
    );
    await escrowCredit(tx, actor.id, id);
    return id;
  });
}

/** Language names as skill tags: lowercase, spaces as hyphens (§6.6 "Normalization"). */
const asTag = (language: string) => language.toLowerCase().replace(/[\s_]+/g, '-');

/** How well a request fits a reviewer: the sum of their skill weights in its languages. */
export function languageOverlap(languages: readonly string[], vector: Readonly<Record<string, number>>): number {
  return languages.reduce((sum, language) => sum + (vector[asTag(language)] ?? 0), 0);
}

export type ClaimableRequest = ReviewRequestRow & { overlap: number };

/** Open requests at the member's university they may claim, best language fit first (§8 F15 "Claim and verify" step 1). */
export async function listClaimable(actor: Actor): Promise<ClaimableRequest[]> {
  const universityId = await requireReviewsOpen(actor);
  const [limit, vector] = await Promise.all([getSetting('reviews.listLimit'), getSkillVector(actor.id)]);
  const weights = vector?.vector ?? {};
  return (await claimableReviewRequests(universityId, actor.id, limit))
    .map((request) => ({ ...request, overlap: languageOverlap(request.languages, weights) }))
    .sort((a, b) => b.overlap - a.overlap || b.createdAt.getTime() - a.createdAt.getTime());
}

export const requestIdSchema = z.object({ requestId: z.uuid() });

/**
 * Ends a request whose pull request can no longer be reviewed (closed, merged, or gone private):
 * it expires and its author gets the credit back (§8 F15 "Edge cases").
 */
export async function closeWithRefund(
  requestId: string,
  reason: 'pull_closed' | 'pull_missing' | 'expired' | 'withdrawn',
  options: { authorId?: string; from?: readonly ('open' | 'claimed')[] } = {},
): Promise<boolean> {
  const from = options.from ?? ['open', 'claimed'];
  const closed = await getDb().transaction(async (tx) => {
    const request = await lockReviewRequest(requestId, tx);
    if (!request || !(from as readonly string[]).includes(request.status)) return null;
    if (options.authorId !== undefined && request.authorUserId !== options.authorId) return null;
    await setReviewRequestStatus(requestId, 'expired', tx);
    await settleEscrow(tx, { authorId: request.authorUserId, requestId, outcome: 'refund' });
    return request.authorUserId;
  });
  if (closed === null) return false;
  // Withdrawing is the author's own doing; everything else is news to them.
  if (reason !== 'withdrawn') await insertNotification(closed, 'review_refunded', { requestId, reason });
  return true;
}

/** The author takes back a request nobody has claimed yet; the credit returns to them. */
export async function withdrawReviewRequest(actor: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  const { requestId } = requestIdSchema.parse(raw);
  if (!(await closeWithRefund(requestId, 'withdrawn', { authorId: actor.id, from: ['open'] }))) {
    throw new NotFoundError('reviews.not_withdrawable', 'Only your own requests that nobody has claimed can be withdrawn.');
  }
}

export type ReviewsAccess = { state: 'open' } | { state: 'locked'; current: number; required: number } | { state: 'unverified' };

/** Whether the member can use the Review Exchange, and the unlock progress when not yet (CLAUDE.md §1.4). */
export async function reviewsAccess(actor: Pick<Member, 'verified' | 'universityId'>): Promise<ReviewsAccess> {
  if (!actor.verified || actor.universityId === null) return { state: 'unverified' };
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'reviews');
  if (!unlock || unlock.unlocked) return { state: 'open' };
  return { state: 'locked', current: unlock.current, required: unlock.required };
}

/**
 * Claims an open request (§8 F15 "Claim and verify" step 2). Claiming reads nothing from GitHub, so
 * it is instant; a pull request that closed or vanished meanwhile is caught by `verify_review`, which
 * refunds the author. The author is told who claimed it.
 */
export async function claimRequest(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ claimTtlHours: number }> {
  const universityId = await requireReviewsOpen(actor);
  const { requestId } = requestIdSchema.parse(raw);
  const request = await getReviewRequest(requestId);
  if (request?.status !== 'open' || request.universityId !== universityId || request.expiresAt <= now) {
    throw new NotFoundError('reviews.not_open', 'That request is no longer open.');
  }
  if (request.authorUserId === actor.id) throw new ValidationError('reviews.own', 'You cannot review your own pull request.');
  if (await isBlockedEitherWay(actor.id, request.authorUserId)) throw new NotFoundError('reviews.not_open', 'That request is no longer open.');
  if (!(await claimReviewRequest(requestId, actor.id, now))) throw new ConflictError('reviews.taken', 'Someone else just claimed that request.');
  await insertNotification(request.authorUserId, 'review_claimed', { requestId, login: actor.login ?? '', repo: request.repoFullName, number: request.prNumber });
  return { claimTtlHours: await getSetting('reviews.claimTtlHours') };
}

/** Gives a claim back so someone else can take the request. */
export async function unclaimRequest(actor: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  const { requestId } = requestIdSchema.parse(raw);
  if (!(await releaseReviewClaim(requestId, actor.id))) throw new NotFoundError('reviews.not_claimed', 'You do not hold a claim on that request.');
}

/** When a claim made at `claimedAt` runs out (`reviews.claimTtlHours`). */
export const claimDeadline = (claimedAt: Date, claimTtlHours: number): Date => new Date(claimedAt.getTime() + claimTtlHours * MS_PER_HOUR);

export type ReviewsOverview = {
  credits: CreditOverview;
  claimable: ClaimableRequest[];
  mine: ReviewRequestRow[];
  claimed: ReviewRequestRow[];
  rules: {
    minLineComments: number;
    claimTtlHours: number;
    requestTtlDays: number;
    autoSettleDays: number;
    disputeWindowDays: number;
    disputeNoteMaxChars: number;
  };
};

/** Everything the Review Exchange page shows a member whose university has it open. */
export async function getReviewsOverview(actor: Actor): Promise<ReviewsOverview> {
  await requireReviewsOpen(actor);
  const limit = await getSetting('reviews.listLimit');
  const [credits, claimable, mine, claimed, minLineComments, claimTtlHours, requestTtlDays, autoSettleDays, disputeWindowDays, disputeNoteMaxChars] = await Promise.all([
    getCredits(actor.id),
    listClaimable(actor),
    authoredReviewRequests(actor.id, limit),
    claimedReviewRequests(actor.id, limit),
    getSetting('reviews.minLineComments'),
    getSetting('reviews.claimTtlHours'),
    getSetting('reviews.requestTtlDays'),
    getSetting('reviews.autoSettleDays'),
    getSetting('reviews.disputeWindowDays'),
    getSetting('reviews.disputeNoteMaxChars'),
  ]);
  return { credits, claimable, mine, claimed, rules: { minLineComments, claimTtlHours, requestTtlDays, autoSettleDays, disputeWindowDays, disputeNoteMaxChars } };
}
