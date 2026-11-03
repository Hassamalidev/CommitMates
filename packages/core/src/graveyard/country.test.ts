import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { graveyardResultSchema, type GraveyardResult } from './schemas';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let viewer: string;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = (resource = 'core') => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': resource });
const TWO_YEARS_AGO = new Date(Date.now() - 730 * 86_400_000).toISOString();

/** Three inactive repositories of developers in the Testland index. */
const REPOS = [
  { id: 6001, owner: 7001, name: 'dash', stars: 40, forks: 5, issues: 6, license: 'MIT', size: 300 },
  { id: 6002, owner: 7002, name: 'charts', stars: 8, forks: 1, issues: 1, license: null, size: 50 },
  { id: 6003, owner: 7003, name: 'forms', stars: 120, forks: 20, issues: 30, license: 'MIT', size: 900 },
];
const fullName = (repo: (typeof REPOS)[number]) => `dev-${repo.owner}/${repo.name}`;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  registerAllTools();
  const [uni] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Country Uni', 'country-uni', 'Testland', 'TL', '{}', 'admin', 'c') returning id`;
  viewer = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${viewer}, 'UTC', ${uni!.id}, now())`;
  for (const repo of REPOS) {
    await database.sql`insert into gh_users (github_id, login, in_country_index, index_country_code, fetched_at) values (${repo.owner}, ${`dev-${repo.owner}`}, true, 'TL', now())`;
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, stars, forks, open_issues, license_spdx, is_fork, size_kb, pushed_at, fetched_at)
                       values (${repo.id}, ${repo.owner}, ${fullName(repo)}, ${repo.name}, 'A react project', '{react}', ${repo.stars}, ${repo.forks}, ${repo.issues}, ${repo.license}, false, ${repo.size}, ${TWO_YEARS_AGO}, now())`;
  }
  // An account indexed in another country never shows up here.
  await database.sql`insert into gh_users (github_id, login, in_country_index, index_country_code, fetched_at) values (7999, 'elsewhere', true, 'XE', now())`;
  await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, stars, is_fork, pushed_at, fetched_at)
                     values (6999, 7999, 'elsewhere/react-thing', 'react-thing', 'A react project', '{react}', 500, false, ${TWO_YEARS_AGO}, now())`;
  await database.sql`
    insert into taxonomy_expansions (term, slug, items, sample_size, computed_at, expires_at)
    values ('react', 'react', ${database.sql.json([{ kind: 'topic', value: 'react', score: 1, source: 'alias' }])}, 10, now(), now() + interval '1 day')`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 3000, remaining: 2999, reset: reset() } } }),
    ),
    http.get(`${API}/repos/:owner/:repo/readme`, () => new HttpResponse('# Project\nWork in progress', { headers: { ...headers(), 'content-type': 'text/plain' } })),
    http.get(`${API}/repos/:owner/:repo/contributors`, () => HttpResponse.json([{ contributions: 12 }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/commits`, () => HttpResponse.json([{ commit: { message: 'wip', author: { date: TWO_YEARS_AGO } } }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/releases`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/tags`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/issues`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/stargazers`, () => HttpResponse.json([], { headers: headers() })),
    // The same repositories, as GitHub's search would return them for the global scope.
    http.get(`${API}/search/repositories`, () =>
      HttpResponse.json(
        {
          total_count: REPOS.length,
          incomplete_results: false,
          items: REPOS.map((repo) => ({
            id: repo.id,
            full_name: fullName(repo),
            name: repo.name,
            description: 'A react project',
            topics: ['react'],
            stargazers_count: repo.stars,
            forks_count: repo.forks,
            open_issues_count: repo.issues,
            fork: false,
            size: repo.size,
            license: repo.license ? { spdx_id: repo.license } : null,
            created_at: '2020-01-01T00:00:00Z',
            pushed_at: TWO_YEARS_AGO,
            owner: { id: repo.owner, login: `dev-${repo.owner}` },
          })),
        },
        { headers: headers('search') },
      ),
    ),
  );
});

async function search(scope: 'global' | 'country'): Promise<GraveyardResult> {
  const run = await startToolRun('graveyard', { q: 'react', scope }, { userId: viewer });
  if (run.status === 'done') return graveyardResultSchema.parse(run.result);
  await runTick({ budgetMs: 30_000, onlyJobId: run.jobId });
  const [job] = await database.sql<{ status: string; result_ref: unknown; last_error: string | null }[]>`select status, result_ref, last_error from jobs where id = ${run.jobId}`;
  expect(job, job?.last_error ?? '').toMatchObject({ status: 'done' });
  return graveyardResultSchema.parse(await loadToolResult(job!.result_ref));
}

describe('the Graveyard country scope', () => {
  it('searches the index of the member’s country and scores results exactly like global ones', async () => {
    const country = await search('country');
    const global = await search('global');
    const byName = (result: GraveyardResult) => Object.fromEntries(result.items.map((item) => [item.fullName, item]));
    expect(Object.keys(byName(country)).sort()).toEqual(REPOS.map(fullName).sort());
    expect(country.items.some((item) => item.fullName === 'elsewhere/react-thing')).toBe(false);
    for (const [name, item] of Object.entries(byName(country))) {
      const twin = byName(global)[name];
      expect(twin, name).toBeDefined();
      // Same inputs, same signals, same scoring: only the relevance order differs between sources.
      expect({ revivability: item.revivability, unfinished: item.unfinished, difficulty: item.difficulty, signals: item.signals, listing: item.listing }).toEqual({
        revivability: twin!.revivability,
        unfinished: twin!.unfinished,
        difficulty: twin!.difficulty,
        signals: twin!.signals,
        listing: null,
      });
    }
    expect(country.scope).toBe('country');
  });

  it('needs a verified member', async () => {
    const run = await startToolRun('graveyard', { q: 'react', scope: 'country' });
    expect(run.status).toBe('queued');
    if (run.status !== 'queued') return;
    await runTick({ budgetMs: 10_000, onlyJobId: run.jobId });
    const [job] = await database.sql<{ status: string; user_message: string | null }[]>`select status, user_message from jobs where id = ${run.jobId}`;
    expect(job).toMatchObject({ status: 'failed' });
  });
});
