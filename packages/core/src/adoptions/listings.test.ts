import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { enqueue, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { dismissSuggestion, getProjects, listRepo, weekStart, withdrawRepo } from './listings';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let counter = 0;
let uni: string;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });
const monthsAgo = (months: number) => new Date(Date.now() - months * 30.44 * 86_400_000);

type Repo = { name: string; pushedMonthsAgo: number; readme: string | null; commits: number; fork?: boolean; message?: string };

/** README text per repository name the mocked GitHub serves. */
let readmes = new Map<string, string | null>();
let commitCounts = new Map<string, number>();
let messages = new Map<string, string>();

async function member(repos: Repo[]): Promise<{ id: string; githubId: number; verified: boolean }> {
  counter += 1;
  const n = counter;
  const githubId = 990_000 + n;
  const id = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${githubId}, ${`owner-${n}`})`;
  for (const [index, repo] of repos.entries()) {
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, pushed_at, fetched_at)
                       values (${githubId * 10 + index}, ${githubId}, ${`owner-${n}/${repo.name}`}, ${repo.name}, ${repo.fork ?? false}, ${monthsAgo(repo.pushedMonthsAgo)}, now())`;
    readmes.set(repo.name, repo.readme);
    commitCounts.set(repo.name, repo.commits);
    messages.set(repo.name, repo.message ?? 'WIP: still building');
  }
  return { id, githubId, verified: true };
}

const suggestions = async (userId: string) =>
  (await database.sql<{ name: string }[]>`
    select r.name from listing_suggestions s join gh_repos r on r.github_id = s.repo_github_id
    where s.owner_user_id = ${userId} order by r.name`).map((row) => row.name);

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  readmes = new Map();
  commitCounts = new Map();
  messages = new Map();
  await database.sql`truncate jobs, analysis_cache, api_cache, github_budgets cascade`;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })),
    http.get(`${API}/repos/:owner/:repo/readme`, ({ params }) => {
      const readme = readmes.get(params.repo as string);
      return readme ? new HttpResponse(readme, { headers: { ...headers(), 'content-type': 'text/plain' } }) : HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() });
    }),
    http.get(`${API}/repos/:owner/:repo/contributors`, ({ params }) => HttpResponse.json([{ contributions: commitCounts.get(params.repo as string) ?? 0 }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/commits`, ({ params }) =>
      HttpResponse.json([{ commit: { message: messages.get(params.repo as string) ?? 'Initial commit', author: { date: '2025-01-01T00:00:00Z' } } }], { headers: headers() }),
    ),
    http.get(`${API}/repos/:owner/:repo/releases`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/tags`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/issues`, () => HttpResponse.json([], { headers: headers() })),
  );
});

async function suggestFor(userId: string) {
  const job = await enqueue('suggest_listings', { userId });
  await runTick({ budgetMs: 30_000, onlyJobId: job.id });
}

describe('suggest_listings', () => {
  it('suggests the owner’s own idle, unfinished repositories, privately, once a week', async () => {
    const owner = await member([
      { name: 'half-built', pushedMonthsAgo: 12, readme: '# Half built\nWork in progress\n- [ ] auth', commits: 20 },
      { name: 'still-active', pushedMonthsAgo: 1, readme: '# Active\nWork in progress', commits: 20 },
      { name: 'finished', pushedMonthsAgo: 12, readme: '# Finished\n## Installation\nnpm i finished', commits: 20, message: 'Release v1.0' },
      { name: 'no-readme', pushedMonthsAgo: 12, readme: null, commits: 20 },
      { name: 'tiny', pushedMonthsAgo: 12, readme: '# Tiny\nWork in progress', commits: 1 },
      { name: 'a-fork', pushedMonthsAgo: 12, readme: '# Fork\nWork in progress', commits: 20, fork: true },
    ]);
    await withSettings({ 'adoptions.suggestMinUnfinished': 0.5 }, () => suggestFor(owner.id));
    expect(await suggestions(owner.id)).toEqual(['half-built']);

    // The weekly dispatch queues one run per member and week.
    const dispatch = await enqueue('suggest_listings', {}, { idempotencyKey: `dispatch:${Math.random()}` });
    await runTick({ budgetMs: 30_000, onlyJobId: dispatch.id });
    const [queued] = await database.sql<{ idempotency_key: string }[]>`
      select idempotency_key from jobs where type = 'suggest_listings' and payload->>'userId' = ${owner.id} and status = 'queued'`;
    expect(queued?.idempotency_key).toBe(`listings:${owner.id}:${weekStart(new Date())}`);
  });

  it('never suggests a listed or dismissed repository again', async () => {
    const owner = await member([
      { name: 'one', pushedMonthsAgo: 12, readme: '# One\nWork in progress', commits: 20 },
      { name: 'two', pushedMonthsAgo: 12, readme: '# Two\nWork in progress', commits: 20 },
    ]);
    await suggestFor(owner.id);
    const projects = await getProjects(owner);
    const [one, two] = projects.suggestions.sort((a, b) => a.fullName.localeCompare(b.fullName));
    await listRepo(owner, { repoGithubId: one!.githubId, note: 'Needs a frontend' });
    await dismissSuggestion(owner, { repoGithubId: two!.githubId });
    await database.sql`delete from jobs`;
    await suggestFor(owner.id);
    const after = await getProjects(owner);
    expect(after.suggestions).toEqual([]);
    expect(after.listings.map((listing) => [listing.fullName, listing.note, listing.status])).toEqual([[one!.fullName, 'Needs a frontend', 'listed']]);
    // A dismissed repository is still the owner's to list by hand, but it is not offered as "other".
    expect(after.others.map((repo) => repo.githubId)).not.toContain(two!.githubId);
  });
});

describe('listings', () => {
  it('lists only the owner’s own repositories, with a short note, once; withdrawing frees it', async () => {
    const owner = await member([{ name: 'mine', pushedMonthsAgo: 12, readme: '# Mine', commits: 20 }]);
    const other = await member([{ name: 'theirs', pushedMonthsAgo: 12, readme: '# Theirs', commits: 20 }]);
    const [mine] = (await getProjects(owner)).others;
    const [theirs] = (await getProjects(other)).others;
    await expect(listRepo(owner, { repoGithubId: theirs!.githubId })).rejects.toMatchObject({ code: 'listings.not_yours' });
    await withSettings({ 'adoptions.noteMaxChars': 5 }, async () => {
      await expect(listRepo(owner, { repoGithubId: mine!.githubId, note: 'far too long' })).rejects.toMatchObject({ code: 'listings.note_long', field: 'note' });
    });
    const listingId = await listRepo(owner, { repoGithubId: mine!.githubId });
    await expect(listRepo(owner, { repoGithubId: mine!.githubId })).rejects.toMatchObject({ code: 'listings.already_listed' });
    await expect(withdrawRepo(other, { listingId })).rejects.toMatchObject({ code: 'listings.not_listed' });
    await withdrawRepo(owner, { listingId });
    await expect(listRepo(owner, { repoGithubId: mine!.githubId })).resolves.toEqual(expect.any(String));
    await expect(getProjects({ id: owner.id, githubId: owner.githubId, verified: false })).rejects.toMatchObject({ code: 'listings.verify_first' });
  });
});
