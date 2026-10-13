import { createMswServer } from '@commitmates/config/testing/msw';
import { encrypt, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubServerError,
  GitHubValidationError,
  RATE_LIMIT_FRAGMENT,
  RateLimitError,
  SERVER_IDENTITY,
  githubFor,
  resetGitHubClientState,
  type TokenIdentity,
} from './index';

const API = 'https://api.github.com';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const RESET_EPOCH = Math.floor(NOW.getTime() / 1000) + 1800;

let database: TestDatabase;
const server = createMswServer();

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
});

const rateHeaders = (resource: string, remaining: number, limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(RESET_EPOCH),
  'x-ratelimit-resource': resource,
  'x-github-request-id': 'REQ-1',
});

const rateLimitHandler = (overrides: Record<string, { limit: number; remaining: number }> = {}) =>
  http.get(`${API}/rate_limit`, () =>
    HttpResponse.json({
      resources: {
        core: { limit: 5000, remaining: 4990, reset: RESET_EPOCH },
        search: { limit: 30, remaining: 30, reset: RESET_EPOCH },
        graphql: { limit: 5000, remaining: 5000, reset: RESET_EPOCH },
        ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { ...value, reset: RESET_EPOCH }])),
      },
    }),
  );

const userSchema = z.object({ login: z.string(), id: z.number() });
const client = (identity: TokenIdentity = SERVER_IDENTITY, sleep = vi.fn(() => Promise.resolve())) =>
  githubFor(identity, { now: () => NOW, random: () => 0, sleep });

const budget = async (resource: string, identity = 'server') => {
  const [row] = await database.sql`
    select "limit", remaining, reset_at, last_call_at from github_budgets
    where token_identity = ${identity} and resource = ${resource}`;
  return row;
};

describe('REST GET', () => {
  it('reads limits from /rate_limit before the first call, then records them from headers', async () => {
    let rateLimitCalls = 0;
    server.use(
      http.get(`${API}/rate_limit`, () => {
        rateLimitCalls += 1;
        return HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: RESET_EPOCH } } });
      }),
      http.get(`${API}/users/octocat`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('token local-github-token');
        expect(request.headers.get('user-agent')).toContain('CommitMates/1.0 (dev@example.com)');
        return HttpResponse.json(
          { login: 'octocat', id: 583231, extra: 'stripped' },
          { headers: { ...rateHeaders('core', 4989), etag: '"abc"' } },
        );
      }),
    );

    const gh = client();
    expect(await gh.get('GET /users/{username}', { username: 'octocat' }, userSchema)).toEqual({
      login: 'octocat',
      id: 583231,
    });
    await gh.get('GET /users/{username}', { username: 'octocat' }, userSchema);

    expect(rateLimitCalls).toBe(1);
    expect(await budget('core')).toMatchObject({ limit: 5000, remaining: 4989 });
  });

  it('sends conditional headers and serves the cached body on 304', async () => {
    const seen: (string | null)[] = [];
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat`, ({ request }) => {
        seen.push(request.headers.get('if-none-match'));
        if (request.headers.get('if-none-match') === '"v1"') {
          return new HttpResponse(null, { status: 304, headers: rateHeaders('core', 4989) });
        }
        return HttpResponse.json(
          { login: 'octocat', id: 1 },
          { headers: { ...rateHeaders('core', 4989), etag: '"v1"', 'last-modified': 'Wed, 14 Oct 2026 10:00:00 GMT' } },
        );
      }),
    );

    const gh = client();
    const first = await gh.get('GET /users/{username}', { username: 'octocat' }, userSchema);
    const second = await gh.get('GET /users/{username}', { username: 'octocat' }, userSchema);

    expect(second).toEqual(first);
    expect(seen).toEqual([null, '"v1"']);
    const cached = await database.sql`select token_identity, url, etag, last_modified from api_cache`;
    expect(cached).toEqual([
      expect.objectContaining({
        token_identity: 'server',
        url: `${API}/users/octocat`,
        etag: '"v1"',
        last_modified: 'Wed, 14 Oct 2026 10:00:00 GMT',
      }),
    ]);
  });

  it('refuses to dip into the reserve and reports when the limit resets', async () => {
    server.use(rateLimitHandler({ core: { limit: 5000, remaining: 200 } }));
    const error = await client()
      .get('GET /users/{username}', { username: 'octocat' }, userSchema)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetAt.getTime()).toBe(RESET_EPOCH * 1000);
  });

  it('spends freely again once the window has reset', async () => {
    await database.sql`insert into github_budgets (token_identity, resource, "limit", remaining, reset_at, updated_at)
                       values ('server', 'core', 5000, 0, ${new Date(NOW.getTime() - 1000)}, now())`;
    server.use(
      http.get(`${API}/users/octocat`, () =>
        HttpResponse.json({ login: 'octocat', id: 1 }, { headers: rateHeaders('core', 4999) }),
      ),
    );
    await expect(client().get('GET /users/{username}', { username: 'octocat' }, userSchema)).resolves.toMatchObject({
      login: 'octocat',
    });
  });

  it('maps 404 to a friendly not-found error', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/nobody`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404 })),
    );
    const error = await client()
      .get('GET /users/{username}', { username: 'nobody' }, userSchema, { what: '@nobody' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubNotFoundError);
    expect((error as GitHubNotFoundError).userMessage).toBe("We couldn't find @nobody on GitHub. Check the spelling?");
  });

  it('maps 422 to a validation error', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/x`, () => HttpResponse.json({ message: 'Validation Failed' }, { status: 422 })),
    );
    await expect(client().get('GET /users/{username}', { username: 'x' }, userSchema)).rejects.toBeInstanceOf(
      GitHubValidationError,
    );
  });

  it('maps 5xx and network failures to a retryable server error', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/a`, () => HttpResponse.json({ message: 'boom' }, { status: 502 })),
      http.get(`${API}/users/b`, () => HttpResponse.error()),
    );
    await expect(client().get('GET /users/{username}', { username: 'a' }, userSchema)).rejects.toBeInstanceOf(
      GitHubServerError,
    );
    await expect(client().get('GET /users/{username}', { username: 'b' }, userSchema)).rejects.toBeInstanceOf(
      GitHubServerError,
    );
  });

  it('treats a response that fails its schema as a server error', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat`, () => HttpResponse.json({ login: 42 }, { headers: rateHeaders('core', 4000) })),
    );
    await expect(client().get('GET /users/{username}', { username: 'octocat' }, userSchema)).rejects.toThrow(
      /did not match its schema/,
    );
  });
});

describe('rate limits', () => {
  it('waits for retry-after on a secondary limit (403 and 429)', async () => {
    for (const status of [403, 429]) {
      server.use(
        rateLimitHandler(),
        http.get(`${API}/users/octocat`, () =>
          HttpResponse.json({ message: 'You have exceeded a secondary rate limit' }, { status, headers: { 'retry-after': '90' } }),
        ),
      );
      const error = await client()
        .get('GET /users/{username}', { username: 'octocat' }, userSchema)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).resetAt.getTime()).toBe(NOW.getTime() + 90_000);
    }
  });

  it('waits until the reset when the primary limit is exhausted', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat`, () =>
        HttpResponse.json({ message: 'API rate limit exceeded' }, { status: 403, headers: rateHeaders('core', 0) }),
      ),
    );
    const error = await client()
      .get('GET /users/{username}', { username: 'octocat' }, userSchema)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetAt.getTime()).toBe(RESET_EPOCH * 1000);
    expect(await budget('core')).toMatchObject({ remaining: 0 });
  });

  it('backs off exponentially from 60 s when a secondary limit carries no hint', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat`, () =>
        HttpResponse.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403, headers: rateHeaders('core', 4000) }),
      ),
    );
    const waits: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const error = await client()
        .get('GET /users/{username}', { username: 'octocat' }, userSchema)
        .catch((caught: unknown) => caught);
      waits.push((error as RateLimitError).resetAt.getTime() - NOW.getTime());
    }
    expect(waits).toEqual([60_000, 120_000, 240_000]);
  });

  it('maps a plain 403 to forbidden', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat`, () =>
        HttpResponse.json({ message: 'Resource not accessible' }, { status: 403, headers: rateHeaders('core', 4000) }),
      ),
    );
    await expect(client().get('GET /users/{username}', { username: 'octocat' }, userSchema)).rejects.toBeInstanceOf(
      GitHubForbiddenError,
    );
  });
});

describe('member tokens', () => {
  it('uses the member token, keeps a separate cache, and flags the token on 401', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                       values (${userId}, 99, 'member', ${encrypt('gho_member-token')}, 1)`;
    const identity: TokenIdentity = { kind: 'user', userId };
    let authorized = true;
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/member`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('token gho_member-token');
        return authorized
          ? HttpResponse.json({ login: 'member', id: 99 }, { headers: { ...rateHeaders('core', 4999), etag: '"m1"' } })
          : HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
      }),
    );

    await client(identity).get('GET /users/{username}', { username: 'member' }, userSchema);
    const cached = await database.sql`select token_identity from api_cache`;
    expect(cached).toEqual([{ token_identity: `user:${userId}` }]);
    expect(await budget('core', `user:${userId}`)).toMatchObject({ remaining: 4999 });

    authorized = false;
    await database.sql`delete from api_cache`;
    await expect(client(identity).get('GET /users/{username}', { username: 'member' }, userSchema)).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
    const [row] = await database.sql`select token_invalid from github_identities where user_id = ${userId}`;
    expect(row!.token_invalid).toBe(true);

    // A token already marked invalid is not sent again.
    await expect(client(identity).get('GET /users/{username}', { username: 'member' }, userSchema)).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });
});

describe('paginate', () => {
  const repoSchema = z.object({ id: z.number() });

  it('follows Link headers and stops at the page cap', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat/repos`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        const link = page < 4 ? `<${API}/users/octocat/repos?page=${page + 1}>; rel="next"` : '';
        return HttpResponse.json([{ id: page * 10 }, { id: page * 10 + 1 }], {
          headers: { ...rateHeaders('core', 4000), ...(link ? { link } : {}) },
        });
      }),
    );

    const all = await client().paginate('GET /users/{username}/repos', { username: 'octocat' }, repoSchema);
    expect(all.items).toHaveLength(8);
    expect(all.truncated).toBe(false);

    await database.sql`delete from api_cache`;
    const capped = await client().paginate('GET /users/{username}/repos', { username: 'octocat' }, repoSchema, {
      maxPages: 2,
    });
    expect(capped.items.map((repo) => repo.id)).toEqual([10, 11, 20, 21]);
    expect(capped.truncated).toBe(true);
  });

  it('uses github.maxPages.default when no cap is given', async () => {
    server.use(
      rateLimitHandler(),
      http.get(`${API}/users/octocat/repos`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json([{ id: page }], {
          headers: { ...rateHeaders('core', 4000), link: `<${API}/x?page=${page + 1}>; rel="next"` },
        });
      }),
    );
    const result = await withSettings({ 'github.maxPages.default': 3 }, () =>
      client().paginate('GET /users/{username}/repos', { username: 'octocat' }, repoSchema),
    );
    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: true });
  });
});

describe('search pacer', () => {
  const searchSchema = z.object({ total_count: z.number() });
  const searchHandler = () =>
    http.get(`${API}/search/repositories`, () =>
      HttpResponse.json({ total_count: 3, items: [] }, { headers: rateHeaders('search', 29, 30) }),
    );

  it('spaces calls by the gap derived from the reported limit', async () => {
    server.use(rateLimitHandler(), searchHandler());
    const sleep = vi.fn(() => Promise.resolve());
    const gh = client(SERVER_IDENTITY, sleep);

    await gh.search('GET /search/repositories', { q: 'topic:react' }, searchSchema);
    expect(sleep).not.toHaveBeenCalled();

    await gh.search('GET /search/repositories', { q: 'topic:vue' }, searchSchema);
    // limit 30 per minute → 2000 ms between calls; "now" is frozen, so the full gap is waited.
    expect(sleep).toHaveBeenCalledWith(2000);
    expect((await budget('search'))!.last_call_at).toEqual(NOW);
  });

  it('asks the job to wait when the pause exceeds the time left', async () => {
    server.use(rateLimitHandler(), searchHandler());
    const gh = client();
    await gh.search('GET /search/repositories', { q: 'a' }, searchSchema);

    const error = await gh
      .search('GET /search/repositories', { q: 'b' }, searchSchema, { deadline: Date.now() + 100 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetAt.getTime()).toBe(NOW.getTime() + 2000);
  });

  it('keeps search calls in reserve', async () => {
    server.use(rateLimitHandler({ search: { limit: 30, remaining: 2 } }));
    await expect(client().search('GET /search/repositories', { q: 'a' }, searchSchema)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});

describe('stats (202 handling)', () => {
  const statsSchema = z.array(z.object({ total: z.number() }));

  it('retries while GitHub computes, then returns the data', async () => {
    let calls = 0;
    server.use(
      rateLimitHandler(),
      http.get(`${API}/repos/o/r/stats/contributors`, () => {
        calls += 1;
        return calls < 3
          ? HttpResponse.json({}, { status: 202, headers: rateHeaders('core', 4000) })
          : HttpResponse.json([{ total: 12 }], { headers: rateHeaders('core', 4000) });
      }),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const result = await client(SERVER_IDENTITY, sleep).stats(
      'GET /repos/{owner}/{repo}/stats/contributors',
      { owner: 'o', repo: 'r' },
      statsSchema,
    );
    expect(result).toEqual({ pending: false, data: [{ total: 12 }] });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('reports pending after fairness.statsRetryMax retries', async () => {
    let calls = 0;
    server.use(
      rateLimitHandler(),
      http.get(`${API}/repos/o/r/stats/contributors`, () => {
        calls += 1;
        return HttpResponse.json({}, { status: 202, headers: rateHeaders('core', 4000) });
      }),
    );
    const result = await withSettings({ 'fairness.statsRetryMax': 2 }, () =>
      client().stats('GET /repos/{owner}/{repo}/stats/contributors', { owner: 'o', repo: 'r' }, statsSchema),
    );
    expect(result).toEqual({ pending: true });
    expect(calls).toBe(3);
    expect(await database.sql`select 1 from api_cache`).toHaveLength(0);
  });

  it('stops retrying when the deadline is near', async () => {
    let calls = 0;
    server.use(
      rateLimitHandler(),
      http.get(`${API}/repos/o/r/stats/contributors`, () => {
        calls += 1;
        return HttpResponse.json({}, { status: 202, headers: rateHeaders('core', 4000) });
      }),
    );
    const result = await client().stats(
      'GET /repos/{owner}/{repo}/stats/contributors',
      { owner: 'o', repo: 'r' },
      statsSchema,
      { deadline: Date.now() + 500 },
    );
    expect(result).toEqual({ pending: true });
    expect(calls).toBe(1);
  });
});

describe('graphql', () => {
  const query = `query($login: String!) { user(login: $login) { login } ${RATE_LIMIT_FRAGMENT} }`;
  const resultSchema = z.object({ user: z.object({ login: z.string() }).nullable() });
  const rateLimit = { limit: 5000, cost: 3, remaining: 4321, resetAt: '2026-10-14T12:30:00Z' };

  it('validates the result and updates the budget from rateLimit', async () => {
    server.use(
      rateLimitHandler(),
      http.post(`${API}/graphql`, async ({ request }) => {
        const body = (await request.json()) as { variables: { login: string } };
        return HttpResponse.json({ data: { user: { login: body.variables.login }, rateLimit } });
      }),
    );
    const data = await client().graphql(query, { login: 'octocat' }, resultSchema);
    expect(data).toEqual({ user: { login: 'octocat' } });
    expect(await budget('graphql')).toMatchObject({ limit: 5000, remaining: 4321 });
  });

  it('refuses a query without rateLimit', async () => {
    await expect(client().graphql('query { viewer { login } }', {}, resultSchema)).rejects.toThrow(/rateLimit/);
  });

  it('maps GraphQL error types', async () => {
    const respond = (type: string) =>
      http.post(`${API}/graphql`, () =>
        HttpResponse.json({ data: { user: null, rateLimit }, errors: [{ type, message: `problem: ${type}` }] }),
      );

    server.use(rateLimitHandler(), respond('NOT_FOUND'));
    await expect(client().graphql(query, { login: 'x' }, resultSchema, { what: '@x' })).rejects.toBeInstanceOf(
      GitHubNotFoundError,
    );

    server.use(respond('RATE_LIMITED'));
    const limited = await client().graphql(query, { login: 'x' }, resultSchema).catch((caught: unknown) => caught);
    expect(limited).toBeInstanceOf(RateLimitError);
    expect((limited as RateLimitError).resetAt.toISOString()).toBe('2026-10-14T12:30:00.000Z');

    server.use(respond('FORBIDDEN'));
    await expect(client().graphql(query, { login: 'x' }, resultSchema)).rejects.toBeInstanceOf(GitHubForbiddenError);

    server.use(respond('SOMETHING_ELSE'));
    await expect(client().graphql(query, { login: 'x' }, resultSchema)).rejects.toThrow(/problem: SOMETHING_ELSE/);
  });

  it('keeps GraphQL points in reserve', async () => {
    server.use(rateLimitHandler({ graphql: { limit: 5000, remaining: 300 } }));
    await expect(client().graphql(query, { login: 'x' }, resultSchema)).rejects.toBeInstanceOf(RateLimitError);
  });
});
