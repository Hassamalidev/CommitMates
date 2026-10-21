import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { grantStarterCredits } from './ledger';
import {
  claimRequest,
  createReviewRequest,
  extensionOf,
  getReviewsOverview,
  languageOverlap,
  listClaimable,
  mayRequestReview,
  pullRequestLanguages,
  unclaimRequest,
} from './requests';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let elsewhere: string;
let counter = 0;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });

type Person = { id: string; login: string; verified: boolean; universityId: string | null; hasValidToken: boolean };

async function member(universityId: string = uni, credits = 1): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `reviewer-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${660_000 + counter}, ${login})`;
  if (credits > 0) await database.sql`insert into credit_ledger (user_id, delta, reason) values (${id}, ${credits}, 'starter')`;
  return { id, login, verified: true, universityId, hasValidToken: false };
}

/** A pull request GitHub reports for `author` (open unless said otherwise). */
function pull(owner: string, repo: string, number: number, author: string, overrides: Record<string, unknown> = {}) {
  return {
    number,
    state: 'open',
    merged: false,
    title: 'Add parser',
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    user: { login: author },
    author_association: 'CONTRIBUTOR',
    base: { repo: { full_name: `${owner}/${repo}`, private: false, owner: { login: owner } } },
    ...overrides,
  };
}

function servePull(owner: string, repo: string, number: number, author: string, files: string[] = ['src/parser.ts', 'src/lexer.ts', 'README.md'], overrides: Record<string, unknown> = {}) {
  server.use(
    http.get(`${API}/repos/${owner}/${repo}/pulls/${number}`, () => HttpResponse.json(pull(owner, repo, number, author, overrides), { headers: headers() })),
    http.get(`${API}/repos/${owner}/${repo}/pulls/${number}/files`, () => HttpResponse.json(files.map((filename) => ({ filename })), { headers: headers() })),
  );
}

const open = <T,>(run: () => Promise<T>) => withSettings({ 'unlock.reviews.minMembers': 1 }, run);
const balance = async (userId: string) => (await database.sql<{ balance: number }[]>`select coalesce(sum(delta), 0)::int as balance from credit_ledger where user_id = ${userId}`)[0]?.balance;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Review Uni', 'review-uni', 'Testland', 'TL', '{}', 'admin', 'a'), ('Far Uni', 'far-uni', 'Testland', 'TL', '{}', 'admin', 'b') returning id`;
  uni = rows[0]!.id;
  elsewhere = rows[1]!.id;
  await database.sql`
    insert into languages (name, color, extensions, aliases, synced_at) values
      ('TypeScript', '#3178c6', '{.ts,.cts,.mts}', '{ts}', now()),
      ('Markdown', '#083fa1', '{.md,.markdown}', '{}', now()),
      ('C', '#555555', '{.c,.h}', '{}', now()),
      ('C++', '#f34b7d', '{.cpp,.h}', '{}', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })));
});

describe('pure helpers', () => {
  it('reads extensions, language overlap and who may ask for a review', () => {
    expect([extensionOf('src/a.TS'), extensionOf('Dockerfile'), extensionOf('.github/x'), extensionOf('docs/.env')]).toEqual(['.ts', null, null, null]);
    expect(languageOverlap(['TypeScript', 'Objective C'], { typescript: 0.5, 'objective-c': 0.25, go: 1 })).toBe(0.75);
    expect(mayRequestReview({ authorLogin: 'Ada', repoOwnerLogin: 'org' }, 'ada')).toBe(true);
    expect(mayRequestReview({ authorLogin: 'someone', repoOwnerLogin: 'ADA' }, 'ada')).toBe(true);
    expect(mayRequestReview({ authorLogin: 'someone', repoOwnerLogin: 'org' }, 'ada')).toBe(false);
  });

  it('ranks the languages of changed files by file count, counting shared extensions for each language', async () => {
    expect(await pullRequestLanguages(['a.ts', 'b.ts', 'x.h', 'README.md', 'Makefile'], 5)).toEqual(['TypeScript', 'C', 'C++', 'Markdown']);
    expect(await pullRequestLanguages(['a.ts', 'b.ts', 'x.h'], 1)).toEqual(['TypeScript']);
  });
});

describe('createReviewRequest', () => {
  it('stays closed until the university reaches unlock.reviews.minMembers', async () => {
    const author = await member();
    await withSettings({ 'unlock.reviews.minMembers': 10_000 }, async () => {
      await expect(createReviewRequest(author, { prUrl: 'https://github.com/o/r/pull/1' })).rejects.toMatchObject({ code: 'reviews.locked' });
    });
  });

  it('records the pull request with its languages and holds one credit in escrow', async () => {
    const author = await member();
    servePull(author.login, 'parser', 7, author.login);
    const id = await open(() => createReviewRequest(author, { prUrl: `https://github.com/${author.login}/parser/pull/7/files` }));
    const [row] = await database.sql`select status, repo_full_name, pr_number, languages, pr_url, expires_at > now() + interval '13 days' as later from review_requests where id = ${id}`;
    expect(row).toMatchObject({ status: 'open', repo_full_name: `${author.login}/parser`, pr_number: 7, languages: ['TypeScript', 'Markdown'], later: true });
    expect(await balance(author.id)).toBe(0);
    expect(await database.sql`select delta, reason, request_id from credit_ledger where user_id = ${author.id} and reason = 'escrow'`).toEqual([
      { delta: -1, reason: 'escrow', request_id: id },
    ]);
    // One live request per pull request.
    await grantStarterCredits(author.id);
    await database.sql`insert into credit_ledger (user_id, delta, reason) values (${author.id}, 1, 'admin_adjust')`;
    await expect(open(() => createReviewRequest(author, { prUrl: `https://github.com/${author.login}/parser/pull/7` }))).rejects.toMatchObject({
      code: 'reviews.duplicate',
    });
  });

  it('refuses links that are not pull requests, closed or private pulls, other people’s pulls, and members without credit', async () => {
    const author = await member();
    await expect(open(() => createReviewRequest(author, { prUrl: 'https://github.com/o/r' }))).rejects.toMatchObject({ code: 'reviews.not_a_pull' });
    servePull('o', 'closed', 1, author.login, [], { state: 'closed', merged: true });
    await expect(open(() => createReviewRequest(author, { prUrl: 'https://github.com/o/closed/pull/1' }))).rejects.toMatchObject({ code: 'reviews.pull_closed' });
    servePull('o', 'theirs', 2, 'someone-else');
    await expect(open(() => createReviewRequest(author, { prUrl: 'https://github.com/o/theirs/pull/2' }))).rejects.toMatchObject({ code: 'reviews.pull_not_yours' });
    server.use(http.get(`${API}/repos/o/gone/pulls/3`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() })));
    await expect(open(() => createReviewRequest(author, { prUrl: 'https://github.com/o/gone/pull/3' }))).rejects.toMatchObject({ code: 'reviews.pull_missing' });

    const broke = await member(uni, 0);
    servePull(broke.login, 'app', 4, broke.login);
    await expect(open(() => createReviewRequest(broke, { prUrl: `https://github.com/${broke.login}/app/pull/4` }))).rejects.toMatchObject({ code: 'reviews.no_credit' });
    expect(await database.sql`select id from review_requests where author_user_id = ${broke.id}`).toEqual([]);
  });
});

describe('claims', () => {
  it('lists claimable requests at the reviewer’s university, best language fit first, never their own or a blocked author’s', async () => {
    const [reviewer, goAuthor, tsAuthor, blocked] = [await member(), await member(), await member(), await member()];
    const far = await member(elsewhere);
    await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                       values (${reviewer.id}, '{}', '{"typescript": 0.9, "c": 0.1}', '{typescript}', '{}', now())`;
    servePull(goAuthor.login, 'c-lib', 1, goAuthor.login, ['lib.c']);
    servePull(tsAuthor.login, 'ts-app', 1, tsAuthor.login, ['app.ts']);
    servePull(blocked.login, 'b', 1, blocked.login, ['b.ts']);
    servePull(far.login, 'f', 1, far.login, ['f.ts']);
    servePull(reviewer.login, 'mine', 1, reviewer.login, ['m.ts']);
    await open(async () => {
      for (const person of [goAuthor, tsAuthor, blocked, far, reviewer]) {
        const repo = { [goAuthor.id]: 'c-lib', [tsAuthor.id]: 'ts-app', [blocked.id]: 'b', [far.id]: 'f', [reviewer.id]: 'mine' }[person.id];
        await createReviewRequest(person, { prUrl: `https://github.com/${person.login}/${repo}/pull/1` });
      }
    });
    await database.sql`insert into blocks (blocker, blocked) values (${blocked.id}, ${reviewer.id})`;
    const listed = await open(() => listClaimable(reviewer));
    const mine = listed.filter((request) => [goAuthor.id, tsAuthor.id, blocked.id, far.id, reviewer.id].includes(request.authorUserId));
    expect(mine.map((request) => request.authorUserId)).toEqual([tsAuthor.id, goAuthor.id]);
    expect(mine[0]?.overlap).toBeCloseTo(0.9);
  });

  it('lets one reviewer claim, tells the author, and frees the claim on request', async () => {
    const [author, first, second] = [await member(), await member(), await member()];
    servePull(author.login, 'claimed', 5, author.login);
    const requestId = await open(() => createReviewRequest(author, { prUrl: `https://github.com/${author.login}/claimed/pull/5` }));
    const results = await open(() => Promise.allSettled([claimRequest(first, { requestId }), claimRequest(second, { requestId })]));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [row] = await database.sql<{ status: string; claimed_by: string }[]>`select status, claimed_by from review_requests where id = ${requestId}`;
    expect(row?.status).toBe('claimed');
    const holder = row?.claimed_by === first.id ? first : second;
    expect(await database.sql`select kind, data->>'login' as login from notifications where user_id = ${author.id}`).toEqual([{ kind: 'review_claimed', login: holder.login }]);
    await expect(open(() => claimRequest(author, { requestId }))).rejects.toMatchObject({ code: 'reviews.not_open' });

    await expect(unclaimRequest(holder === first ? second : first, { requestId })).rejects.toMatchObject({ code: 'reviews.not_claimed' });
    await unclaimRequest(holder, { requestId });
    expect((await database.sql`select status, claimed_by from review_requests where id = ${requestId}`)[0]).toEqual({ status: 'open', claimed_by: null });
    await expect(open(() => claimRequest(author, { requestId }))).rejects.toMatchObject({ code: 'reviews.own' });
  });

  it('ends a request with a refund when its pull request closed before anyone claimed it', async () => {
    const [author, reviewer] = [await member(), await member()];
    servePull(author.login, 'merged', 9, author.login);
    const requestId = await open(() => createReviewRequest(author, { prUrl: `https://github.com/${author.login}/merged/pull/9` }));
    expect(await balance(author.id)).toBe(0);
    servePull(author.login, 'merged', 9, author.login, [], { state: 'closed', merged: true });
    await expect(open(() => claimRequest(reviewer, { requestId }))).rejects.toMatchObject({ code: 'reviews.pull_gone' });
    expect((await database.sql`select status from review_requests where id = ${requestId}`)[0]?.status).toBe('expired');
    expect(await balance(author.id)).toBe(1);
    expect((await database.sql`select kind from notifications where user_id = ${author.id}`).map((row) => row.kind)).toContain('review_refunded');
  });

  it('shows the page’s overview with the balance and the rules from settings', async () => {
    const someone = await member(uni, 2);
    const overview = await open(() => getReviewsOverview(someone));
    expect(overview.credits.balance).toBe(2);
    expect(overview.rules).toEqual({ minLineComments: 3, claimTtlHours: 72, requestTtlDays: 14, autoSettleDays: 7 });
    expect(overview.mine).toEqual([]);
  });
});
