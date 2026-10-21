import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified members `unlock.reviews.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 10;

/** Verified classmates so the Review Exchange is open at the test university. */
async function seedClassmates(universityId: string, count: number): Promise<void> {
  await withAppDatabase(async (sql) => {
    for (let index = 0; index < count; index += 1) {
      const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      if (!auth) throw new Error('auth.users insert returned no row');
      await sql`insert into users (id) values (${auth.id}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                values (${auth.id}, 'UTC', ${universityId}, now(), 'email', now())`;
    }
  });
}

type Pull = { owner: string; repo: string; number: number; author: string; reviewer: string };

/**
 * Answers this test process's GitHub calls with fixtures: the rate-limit probe, the pull request, its
 * files, and (once `reviewed`) the reviewer's review with three line comments. Everything else goes
 * to the real `fetch`.
 */
function stubGitHub(pull: Pull, state: { reviewed: boolean }): () => void {
  const original = globalThis.fetch;
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' },
    });
  const base = `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== 'api.github.com') return original(input, init);
    const now = new Date().toISOString();
    switch (url.pathname) {
      case '/rate_limit':
        return json({ resources: { core: { limit: 5000, remaining: 4900, reset } } });
      case base:
        return json({
          number: pull.number,
          state: 'open',
          html_url: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}`,
          user: { login: pull.author },
          author_association: 'OWNER',
          base: { repo: { full_name: `${pull.owner}/${pull.repo}`, private: false, owner: { login: pull.owner } } },
        });
      case `${base}/files`:
        return json([{ filename: 'src/parser.ts' }]);
      case `${base}/reviews`:
        return json(state.reviewed ? [{ id: 4242, user: { login: pull.reviewer }, state: 'COMMENTED', submitted_at: now }] : []);
      case `${base}/comments`:
        return json(state.reviewed ? [1, 2, 3].map((id) => ({ id, user: { login: pull.reviewer }, created_at: now, pull_request_review_id: 4242 })) : []);
      default:
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

test.describe('Review Exchange (e2e flow 6)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a request is claimed, verified on GitHub, rated helpful, and the credit moves to the reviewer', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Review University ${suffix}`, `review-university-${suffix}`);
    const reviewer = await signInTestMember(context, baseURL ?? '');
    const authorContext = await browser.newContext();
    const author = await signInTestMember(authorContext, baseURL ?? '');
    // The request and the verification run in this test process; their info logs would only clutter the report.
    process.env.LOG_LEVEL = 'warn';
    const core = await import('@commitmates/core');
    const db = await import('@commitmates/db');
    const jobs = await import('@commitmates/jobs');
    let restoreFetch: () => void = () => undefined;
    try {
      await prepareMember(reviewer, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(author, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await seedClassmates(universityId, UNLOCK_MEMBERS - 2);
      await withAppDatabase(async (sql) => {
        for (const userId of [reviewer.userId, author.userId]) await sql`insert into credit_ledger (user_id, delta, reason) values (${userId}, 1, 'starter')`;
      });

      // The author asks for a review of their pull request; one credit goes into escrow.
      const pull: Pull = { owner: author.login, repo: 'parser', number: 7, author: author.login, reviewer: reviewer.login };
      const name = `${pull.owner}/${pull.repo}#${pull.number}`;
      const github = { reviewed: false };
      restoreFetch = stubGitHub(pull, github);
      const authorMember = await core.getMember(author.userId);
      if (!authorMember) throw new Error('author is not a member');
      await core.createReviewRequest(authorMember, { prUrl: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}` });

      // The reviewer claims it on the Review Exchange.
      await page.goto('/reviews');
      await expect(page.getByRole('heading', { level: 1, name: 'Give a review, get a review' })).toBeVisible(ACTION_TIMEOUT);
      const request = page.getByRole('article', { name });
      await expect(request.getByText(`Asked by @${author.login}`)).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(page);
      await request.getByRole('button', { name: `Claim ${name}` }).click();
      // Claimed requests leave the open list and wait under “My reviews”.
      await expect(page.getByRole('article', { name })).toHaveCount(0, ACTION_TIMEOUT);

      await page.goto('/reviews?tab=claimed');
      const claim = page.getByRole('article', { name });
      await expect(claim.getByText(/Your claim runs until/)).toBeVisible(ACTION_TIMEOUT);
      await claim.getByRole('button', { name: `I’ve submitted my review of ${name}` }).click();
      await expect(claim.getByText(/We’ll check GitHub for your review/)).toBeVisible(ACTION_TIMEOUT);

      // The verification job reads the review and its line comments from GitHub (fixtures here).
      github.reviewed = true;
      core.registerAllHandlers();
      const [job] = await withAppDatabase(
        (sql) => sql<{ id: string }[]>`
          select j.id from jobs j join review_requests rr on rr.id::text = j.payload->>'requestId'
          where j.type = 'verify_review' and rr.author_user_id = ${author.userId}`,
      );
      expect(job).toBeDefined();
      await jobs.runTick({ budgetMs: 30_000, onlyJobId: job!.id });

      // The author rates the review helpful.
      const authorPage = await authorContext.newPage();
      await authorPage.goto('/reviews?tab=mine');
      const mine = authorPage.getByRole('article', { name });
      await expect(mine.getByText('Reviewed — rate it')).toBeVisible(ACTION_TIMEOUT);
      await expect(mine.getByText(`@${reviewer.login} reviewed it with 3 line comments.`)).toBeVisible();
      await expectNoSeriousA11yViolations(authorPage);
      await mine.getByRole('button', { name: `Rate the review of ${name} helpful` }).click();
      await expect(mine.getByText('Helpful', { exact: true })).toBeVisible(ACTION_TIMEOUT);

      // Balances: the author spent their credit, the reviewer earned one.
      await authorPage.reload();
      await expect(authorPage.getByTestId('credit-balance')).toHaveText('0 credits', ACTION_TIMEOUT);
      await page.reload();
      await expect(page.getByTestId('credit-balance')).toHaveText('2 credits', ACTION_TIMEOUT);
      await expect(page.getByRole('article', { name }).getByText('You earned a credit for this review.')).toBeVisible();
      const balances = await withAppDatabase(
        (sql) => sql<{ user_id: string; balance: number }[]>`select user_id, balance from credit_balances where user_id in ${sql([author.userId, reviewer.userId])}`,
      );
      expect(Object.fromEntries(balances.map((row) => [row.user_id, row.balance]))).toEqual({ [author.userId]: 0, [reviewer.userId]: 2 });
    } finally {
      restoreFetch();
      await db.closeDb();
      await authorContext.close();
      await reviewer.cleanup();
      await author.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
