import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SERVER_IDENTITY, githubFor, resetGitHubClientState } from '../index';

import { fetchStarredRepos } from './starred';

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
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: RESET_EPOCH } } }),
    ),
  );
});

const headers = (next?: string) => ({
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4980',
  'x-ratelimit-reset': String(RESET_EPOCH),
  'x-ratelimit-resource': 'core',
  ...(next ? { link: `<${next}>; rel="next"` } : {}),
});

const repo = (index: number, topics: string[] | null = [`topic-${index}`]) => ({
  id: index,
  full_name: `Owner-${index}/Repo-${index}`,
  topics,
  stargazers_count: 3,
});

describe('fetchStarredRepos', () => {
  it('reads the newest stars first, lowercases names and keeps topics', async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(`${API}/users/someone/starred`, ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json([repo(1), repo(2, null)], { headers: headers() });
      }),
    );
    const starred = await fetchStarredRepos(githubFor(SERVER_IDENTITY), 'someone', { cap: 200 });
    expect(starred).toEqual([
      { fullName: 'owner-1/repo-1', topics: ['topic-1'] },
      { fullName: 'owner-2/repo-2', topics: [] },
    ]);
    expect(Object.fromEntries(requests[0] ?? [])).toMatchObject({ sort: 'created', direction: 'desc', per_page: '100', page: '1' });
  });

  it('stops at the cap across pages', async () => {
    server.use(
      http.get(`${API}/users/someone/starred`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        const perPage = Number(new URL(request.url).searchParams.get('per_page'));
        const items = Array.from({ length: perPage }, (_, index) => repo((page - 1) * perPage + index));
        return HttpResponse.json(items, { headers: headers(`${API}/users/someone/starred?page=${page + 1}`) });
      }),
    );
    expect(await fetchStarredRepos(githubFor(SERVER_IDENTITY), 'someone', { cap: 150 })).toHaveLength(150);
    expect(await fetchStarredRepos(githubFor(SERVER_IDENTITY), 'someone', { cap: 30 })).toHaveLength(30);
  });

  it('reads nothing when the cap is zero', async () => {
    expect(await fetchStarredRepos(githubFor(SERVER_IDENTITY), 'someone', { cap: 0 })).toEqual([]);
  });
});
