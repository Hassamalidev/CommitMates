import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SERVER_IDENTITY, githubFor, resetGitHubClientState } from '../index';

import { fetchPullRequest, listPullRequestFiles, listPullRequestReviewComments, listPullRequestReviews } from './pulls';

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

describe('pull request readers', () => {
  it('maps a pull request, its files, reviews and line comments', async () => {
    server.use(
      http.get(`${API}/repos/o/r/pulls/7`, () =>
        HttpResponse.json(
          {
            number: 7,
            state: 'closed',
            merged: true,
            title: 'Parser',
            html_url: 'https://github.com/o/r/pull/7',
            user: { login: 'ada' },
            author_association: 'CONTRIBUTOR',
            base: { repo: { full_name: 'o/r', private: false, owner: { login: 'o' } } },
          },
          { headers: headers() },
        ),
      ),
      http.get(`${API}/repos/o/r/pulls/7/files`, () => HttpResponse.json([{ filename: 'a.ts' }, { filename: 'b.md' }], { headers: headers() })),
      http.get(`${API}/repos/o/r/pulls/7/reviews`, () =>
        HttpResponse.json(
          [
            { id: 11, user: { login: 'kim' }, state: 'COMMENTED', submitted_at: '2026-10-01T10:00:00Z' },
            { id: 12, user: null, state: 'PENDING' },
          ],
          { headers: headers() },
        ),
      ),
      http.get(`${API}/repos/o/r/pulls/7/comments`, () =>
        HttpResponse.json([{ id: 21, user: { login: 'kim' }, created_at: '2026-10-01T09:59:00Z', pull_request_review_id: 11 }], { headers: headers() }),
      ),
    );
    const client = githubFor(SERVER_IDENTITY);
    expect(await fetchPullRequest(client, 'o', 'r', 7)).toEqual({
      number: 7,
      state: 'closed',
      merged: true,
      title: 'Parser',
      htmlUrl: 'https://github.com/o/r/pull/7',
      authorLogin: 'ada',
      authorAssociation: 'CONTRIBUTOR',
      repoFullName: 'o/r',
      repoOwnerLogin: 'o',
      isPrivate: false,
    });
    expect(await listPullRequestFiles(client, 'o', 'r', 7)).toEqual({ paths: ['a.ts', 'b.md'], truncated: false });
    expect(await listPullRequestReviews(client, 'o', 'r', 7)).toEqual([
      { id: 11, login: 'kim', state: 'COMMENTED', submittedAt: '2026-10-01T10:00:00Z' },
      { id: 12, login: null, state: 'PENDING', submittedAt: null },
    ]);
    expect(await listPullRequestReviewComments(client, 'o', 'r', 7)).toEqual([{ id: 21, login: 'kim', createdAt: '2026-10-01T09:59:00Z', reviewId: 11 }]);
  });
});
