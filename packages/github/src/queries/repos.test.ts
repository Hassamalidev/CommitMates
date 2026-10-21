import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GitHubNotFoundError, SERVER_IDENTITY, githubFor, resetGitHubClientState } from '../index';

import { fetchRepositoryById, listCommits, listForks } from './repos';

const API = 'https://api.github.com';
const RESET_EPOCH = Math.floor(Date.now() / 1000) + 1800;
const server = createMswServer();
let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  await database.sql`delete from api_cache`;
  await database.sql`delete from github_budgets`;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: RESET_EPOCH } } })),
  );
});

const headers = (next?: string) => ({
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4980',
  'x-ratelimit-reset': String(RESET_EPOCH),
  'x-ratelimit-resource': 'core',
  ...(next ? { link: `<${next}>; rel="next"` } : {}),
});

const commit = (sha: string, date: string) => ({ sha, commit: { message: `change ${sha}`, author: { name: 'A', email: null, date } }, author: null, parents: [{ sha: 'p' }] });

describe('listCommits with since', () => {
  it('asks GitHub only for commits from the given time and caps the count', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/repos/adopter/app/commits`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json([commit('c', '2026-05-03T00:00:00Z'), commit('b', '2026-05-02T00:00:00Z'), commit('a', '2026-05-01T00:00:00Z')], { headers: headers() });
      }),
    );
    const { commits, truncated } = await listCommits(githubFor(SERVER_IDENTITY), 'adopter', 'app', { limit: 2, since: '2026-05-01T00:00:00.000Z' });
    expect(seen[0]?.get('since')).toBe('2026-05-01T00:00:00.000Z');
    expect(seen[0]?.get('per_page')).toBe('2');
    expect(commits.map((entry) => entry.sha)).toEqual(['c', 'b']);
    expect(truncated).toBe(true);
  });
});

describe('listForks', () => {
  it('reads forks newest first across pages and stops at the page cap', async () => {
    const pages: string[] = [];
    server.use(
      http.get(`${API}/repos/owner/app/forks`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        pages.push(`${params.get('page')}:${params.get('sort')}`);
        const page = Number(params.get('page'));
        return HttpResponse.json([{ full_name: `user-${page}/app`, owner: { login: `user-${page}` }, created_at: '2026-05-01T00:00:00Z' }], {
          headers: headers(`${API}/repos/owner/app/forks?page=${page + 1}`),
        });
      }),
    );
    const { forks, truncated } = await listForks(githubFor(SERVER_IDENTITY), 'owner', 'app', { maxPages: 2 });
    expect(pages).toEqual(['1:newest', '2:newest']);
    expect(forks).toEqual([
      { fullName: 'user-1/app', ownerLogin: 'user-1', createdAt: '2026-05-01T00:00:00Z' },
      { fullName: 'user-2/app', ownerLogin: 'user-2', createdAt: '2026-05-01T00:00:00Z' },
    ]);
    expect(truncated).toBe(true);
  });
});

describe('fetchRepositoryById', () => {
  it('reads a repository by id, and reports a missing one as not found', async () => {
    server.use(
      http.get(`${API}/repositories/42`, () =>
        HttpResponse.json({ id: 42, full_name: 'renamed/app', private: false, fork: false, size: 10, default_branch: 'main', license: { spdx_id: 'NOASSERTION' } }, { headers: headers() }),
      ),
      http.get(`${API}/repositories/43`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() })),
    );
    await expect(fetchRepositoryById(githubFor(SERVER_IDENTITY), 42)).resolves.toMatchObject({ githubId: 42, fullName: 'renamed/app', name: 'app', licenseSpdx: null });
    await expect(fetchRepositoryById(githubFor(SERVER_IDENTITY), 43)).rejects.toBeInstanceOf(GitHubNotFoundError);
  });
});
