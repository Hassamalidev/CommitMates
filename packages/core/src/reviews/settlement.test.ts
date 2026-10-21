import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { disputeRating, expireReviews, listDisputes, markSubmitted, rateReview, resolveDispute, reviewReputation, verifyReview } from './settlement';

const API = 'https://api.github.com';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let otherUni: string;
let counter = 0;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });

type Person = { id: string; login: string };

async function member(universityId: string = uni): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `settle-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${550_000 + counter}, ${login})`;
  return { id, login };
}

type Seed = { status?: string; claimedHoursAgo?: number; expiresInDays?: number; review?: { verifiedDaysAgo: number; rating?: 'helpful' | 'unhelpful'; ratedDaysAgo?: number } };

/** A request by `author` with one credit in escrow, claimed by `reviewer` unless open. */
async function request(author: Person, reviewer: Person | null, seed: Seed = {}) {
  counter += 1;
  const claimedAt = reviewer ? new Date(Date.now() - (seed.claimedHoursAgo ?? 1) * HOUR_MS) : null;
  const [row] = await database.sql<{ id: string }[]>`
    insert into review_requests (author_user_id, university_id, pr_url, repo_full_name, pr_number, languages, status, claimed_by, claimed_at, expires_at)
    values (${author.id}, ${uni}, ${`https://github.com/${author.login}/app/pull/${counter}`}, ${`${author.login}/app`}, ${counter}, '{TypeScript}',
            ${seed.status ?? (reviewer ? 'claimed' : 'open')}, ${reviewer?.id ?? null}, ${claimedAt}, ${new Date(Date.now() + (seed.expiresInDays ?? 10) * DAY_MS)})
    returning id`;
  const id = row!.id;
  await database.sql`insert into credit_ledger (user_id, delta, reason) values (${author.id}, 1, 'starter')`;
  await database.sql`insert into credit_ledger (user_id, delta, reason, request_id) values (${author.id}, -1, 'escrow', ${id})`;
  if (seed.review && reviewer) {
    const rated = seed.review.rating ? new Date(Date.now() - (seed.review.ratedDaysAgo ?? 0) * DAY_MS) : null;
    await database.sql`insert into reviews (request_id, reviewer_user_id, gh_review_ids, line_comment_count, verified_at, rating, rated_at)
                       values (${id}, ${reviewer.id}, '{1}', 3, ${new Date(Date.now() - seed.review.verifiedDaysAgo * DAY_MS)}, ${seed.review.rating ?? null}, ${rated})`;
    if (seed.review.rating === 'unhelpful') await database.sql`insert into credit_ledger (user_id, delta, reason, request_id) values (${author.id}, 1, 'refund', ${id})`;
  }
  return { id, number: counter, claimedAt, repo: `${author.login}/app` };
}

function serveReview(repo: string, number: number, input: { state?: string; reviews?: unknown[]; comments?: unknown[]; status?: number }) {
  server.use(
    http.get(`${API}/repos/${repo}/pulls/${number}`, () =>
      input.status === 404
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() })
        : HttpResponse.json(
            { number, state: input.state ?? 'open', user: { login: 'x' }, base: { repo: { full_name: repo, private: false, owner: { login: repo.split('/')[0] } } } },
            { headers: headers() },
          ),
    ),
    http.get(`${API}/repos/${repo}/pulls/${number}/reviews`, () => HttpResponse.json(input.reviews ?? [], { headers: headers() })),
    http.get(`${API}/repos/${repo}/pulls/${number}/comments`, () => HttpResponse.json(input.comments ?? [], { headers: headers() })),
  );
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const comment = (id: number, login: string, offsetMs: number) => ({ id, user: { login }, created_at: iso(offsetMs), pull_request_review_id: 1 });
const balance = async (userId: string) =>
  (await database.sql<{ balance: number }[]>`select coalesce(sum(delta), 0)::int as balance from credit_ledger where user_id = ${userId}`)[0]?.balance;
const statusOf = async (id: string) => (await database.sql<{ status: string }[]>`select status from review_requests where id = ${id}`)[0]?.status;
const kinds = async (userId: string) => (await database.sql<{ kind: string }[]>`select kind from notifications where user_id = ${userId} order by created_at`).map((row) => row.kind);

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Settle Uni', 'settle-uni', 'Testland', 'TL', '{}', 'admin', 'a'), ('Other Uni', 'other-uni', 'Testland', 'TL', '{}', 'admin', 'b') returning id`;
  uni = rows[0]!.id;
  otherUni = rows[1]!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })));
});

describe('verification', () => {
  it('verifies a review submitted after the claim with enough line comments after it, and asks the author to rate', async () => {
    const [author, reviewer] = [await member(), await member()];
    const req = await request(author, reviewer);
    serveReview(req.repo, req.number, {
      reviews: [
        { id: 70, user: { login: reviewer.login.toUpperCase() }, state: 'COMMENTED', submitted_at: iso(0) },
        { id: 71, user: { login: reviewer.login }, state: 'PENDING' },
        { id: 72, user: { login: 'someone-else' }, state: 'APPROVED', submitted_at: iso(0) },
      ],
      comments: [comment(1, reviewer.login, 0), comment(2, reviewer.login, 0), comment(3, reviewer.login, 0), comment(4, reviewer.login, -2 * HOUR_MS), comment(5, 'someone-else', 0)],
    });
    expect(await verifyReview({ requestId: req.id, claimedAt: req.claimedAt!.toISOString() }, new Date(), Date.now() + 30_000)).toEqual({ outcome: 'verified' });
    expect(await statusOf(req.id)).toBe('submitted');
    expect((await database.sql`select gh_review_ids, line_comment_count from reviews where request_id = ${req.id}`)[0]).toEqual({ gh_review_ids: ['70'], line_comment_count: 3 });
    expect(await kinds(author.id)).toEqual(['review_submitted']);
  });

  it('waits for more line comments, and frees the request when the claim runs out', async () => {
    const [author, reviewer] = [await member(), await member()];
    const req = await request(author, reviewer);
    serveReview(req.repo, req.number, {
      reviews: [{ id: 80, user: { login: reviewer.login }, state: 'COMMENTED', submitted_at: iso(0) }],
      comments: [comment(1, reviewer.login, 0), comment(2, reviewer.login, 0)],
    });
    const now = new Date();
    const result = await verifyReview({ requestId: req.id, claimedAt: req.claimedAt!.toISOString() }, now, Date.now() + 30_000);
    expect(result.outcome).toBe('not_yet');
    expect(result.retryAt?.getTime()).toBe(now.getTime() + 60 * 60_000);

    const later = new Date(req.claimedAt!.getTime() + 73 * HOUR_MS);
    expect((await verifyReview({ requestId: req.id, claimedAt: req.claimedAt!.toISOString() }, later, Date.now() + 30_000)).outcome).toBe('claim_ended');
    expect(await statusOf(req.id)).toBe('open');
    expect(await kinds(reviewer.id)).toEqual(['review_claim_expired']);
  });

  it('refunds the author when the pull request vanished, or closed without a review', async () => {
    const [author, reviewer] = [await member(), await member()];
    const gone = await request(author, reviewer);
    serveReview(gone.repo, gone.number, { status: 404 });
    expect((await verifyReview({ requestId: gone.id, claimedAt: gone.claimedAt!.toISOString() }, new Date(), Date.now() + 30_000)).outcome).toBe('refunded');
    const closed = await request(author, reviewer);
    serveReview(closed.repo, closed.number, { state: 'closed' });
    expect((await verifyReview({ requestId: closed.id, claimedAt: closed.claimedAt!.toISOString() }, new Date(), Date.now() + 30_000)).outcome).toBe('refunded');
    expect([await statusOf(gone.id), await statusOf(closed.id)]).toEqual(['expired', 'expired']);
    // Two starter credits, two escrows, two refunds.
    expect(await balance(author.id)).toBe(2);
  });

  it('ignores a check for an older claim', async () => {
    const [author, reviewer] = [await member(), await member()];
    const req = await request(author, reviewer);
    expect((await verifyReview({ requestId: req.id, claimedAt: new Date(0).toISOString() }, new Date(), Date.now() + 30_000)).outcome).toBe('stale');
  });

  it('queues one verification per claim, and the job waits instead of failing while the review is missing', async () => {
    const [author, reviewer, stranger] = [await member(), await member(), await member()];
    const req = await request(author, reviewer);
    await expect(markSubmitted(stranger, { requestId: req.id })).rejects.toMatchObject({ code: 'reviews.not_claimed' });
    const jobId = await markSubmitted(reviewer, { requestId: req.id });
    expect(await markSubmitted(reviewer, { requestId: req.id })).toBe(jobId);
    serveReview(req.repo, req.number, {});
    await runTick({ budgetMs: 20_000, onlyJobId: jobId });
    const [job] = await database.sql<{ status: string; attempts: number; later: boolean }[]>`
      select status, attempts, run_at > now() + interval '30 minutes' as later from jobs where id = ${jobId}`;
    expect(job).toEqual({ status: 'queued', attempts: 0, later: true });
  });
});

describe('rating and settlement', () => {
  it('pays the reviewer for a helpful review, once, and only the author may rate', async () => {
    const [author, reviewer] = [await member(), await member()];
    const req = await request(author, reviewer, { status: 'submitted', review: { verifiedDaysAgo: 1 } });
    await expect(rateReview(reviewer, { requestId: req.id, rating: 'helpful' })).rejects.toMatchObject({ code: 'reviews.not_yours' });
    await rateReview(author, { requestId: req.id, rating: 'helpful' });
    expect([await balance(author.id), await balance(reviewer.id), await statusOf(req.id)]).toEqual([0, 1, 'settled_helpful']);
    await expect(rateReview(author, { requestId: req.id, rating: 'unhelpful' })).rejects.toMatchObject({ code: 'reviews.not_ratable' });
    expect(await kinds(reviewer.id)).toEqual(['review_rated']);
  });

  it('refunds the author for an unhelpful review; the reviewer may dispute it within the window', async () => {
    const [author, reviewer, admin, otherMod] = [await member(), await member(), await member(), await member(otherUni)];
    const req = await request(author, reviewer, { status: 'submitted', review: { verifiedDaysAgo: 1 } });
    await rateReview(author, { requestId: req.id, rating: 'unhelpful' });
    expect([await balance(author.id), await balance(reviewer.id), await statusOf(req.id)]).toEqual([1, 0, 'settled_unhelpful']);

    await expect(disputeRating(author, { requestId: req.id, note: 'No' })).rejects.toMatchObject({ code: 'reviews.not_reviewer' });
    await expect(disputeRating(reviewer, { requestId: req.id, note: '' })).rejects.toMatchObject({ code: 'reviews.dispute_note' });
    await disputeRating(reviewer, { requestId: req.id, note: 'I left five line comments that found a real bug.' });
    expect(await statusOf(req.id)).toBe('disputed');

    const adminActor = { id: admin.id, roles: [{ role: 'admin' as const, universityId: null }] };
    const otherActor = { id: otherMod.id, roles: [{ role: 'uni_moderator' as const, universityId: otherUni }] };
    expect((await listDisputes(adminActor)).map((entry) => entry.id)).toContain(req.id);
    expect(await listDisputes(otherActor)).toEqual([]);
    await expect(resolveDispute(otherActor, { requestId: req.id, outcome: 'reviewer' })).rejects.toMatchObject({ code: 'moderation.out_of_scope' });
    await resolveDispute(adminActor, { requestId: req.id, outcome: 'reviewer', note: 'The comments were substantive.' });
    expect([await balance(author.id), await balance(reviewer.id), await statusOf(req.id)]).toEqual([1, 1, 'settled_helpful']);
    expect((await database.sql`select action, data->>'outcome' as outcome from audit_log where target_id = ${req.id}`)[0]).toEqual({
      action: 'reviews.dispute_resolved',
      outcome: 'reviewer',
    });
    expect(await kinds(author.id)).toContain('review_dispute_resolved');
    await expect(resolveDispute(adminActor, { requestId: req.id, outcome: 'author' })).rejects.toMatchObject({ code: 'reviews.not_disputed' });
  });

  it('refuses a dispute after reviews.disputeWindowDays', async () => {
    const [author, reviewer] = [await member(), await member()];
    const req = await request(author, reviewer, { status: 'settled_unhelpful', review: { verifiedDaysAgo: 20, rating: 'unhelpful', ratedDaysAgo: 8 } });
    await expect(disputeRating(reviewer, { requestId: req.id, note: 'It was helpful.' })).rejects.toMatchObject({ code: 'reviews.dispute_late' });
  });
});

describe('expire_reviews', () => {
  it('frees run-out claims, refunds expired requests, settles unrated reviews as helpful and reopens orphaned ones', async () => {
    const [author, reviewer] = [await member(), await member()];
    const ranOut = await request(author, reviewer, { claimedHoursAgo: 80 });
    const fresh = await request(author, reviewer, { claimedHoursAgo: 2 });
    const expired = await request(author, null, { expiresInDays: -1 });
    const unrated = await request(author, reviewer, { status: 'submitted', review: { verifiedDaysAgo: 8 } });
    const recent = await request(author, reviewer, { status: 'submitted', review: { verifiedDaysAgo: 2 } });
    const orphan = await request(author, reviewer, { status: 'submitted' });

    const result = await expireReviews(new Date());
    expect(result.claimsEnded).toBeGreaterThanOrEqual(1);
    expect([await statusOf(ranOut.id), await statusOf(fresh.id), await statusOf(expired.id)]).toEqual(['open', 'claimed', 'expired']);
    expect([await statusOf(unrated.id), await statusOf(recent.id), await statusOf(orphan.id)]).toEqual(['settled_helpful', 'submitted', 'open']);
    // Six starters, six escrows; one refund (expired) and one release (unrated).
    expect([await balance(author.id), await balance(reviewer.id)]).toEqual([1, 1]);
    expect(await kinds(reviewer.id)).toEqual(expect.arrayContaining(['review_claim_expired', 'review_rated']));
    expect(await kinds(author.id)).toContain('review_refunded');
  });
});

describe('reputation', () => {
  it('ranks helpful reviews within the university and maps them to tiers', async () => {
    const reputationUni = (await database.sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values ('Rep Uni', 'rep-uni', 'Testland', 'TL', '{}', 'admin', 'c') returning id`)[0]!.id;
    const people = [await member(reputationUni), await member(reputationUni), await member(reputationUni), await member(reputationUni)];
    const [busy, some, none] = people;
    for (const [reviewer, count] of [
      [busy!, 3],
      [some!, 1],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        const req = await request(people[3]!, reviewer, { status: 'settled_helpful', review: { verifiedDaysAgo: 1, rating: 'helpful' } });
        await database.sql`update review_requests set university_id = ${reputationUni} where id = ${req.id}`;
      }
    }
    expect(await reviewReputation(none!.id, reputationUni)).toEqual({ helpful: 0, percentile: null, tier: 0 });
    expect(await reviewReputation(busy!.id, reputationUni)).toEqual({ helpful: 3, percentile: 0.875, tier: 2 });
    expect(await reviewReputation(some!.id, reputationUni)).toMatchObject({ helpful: 1, percentile: 0.625, tier: 1 });
  });
});
