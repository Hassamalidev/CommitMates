import { createMswServer } from '@commitmates/config/testing/msw';
import { optOutOfIndex, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { SERVER_IDENTITY, githubFor, resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { crawlStep, cursorQuery, guardStorage, middleDay } from './service';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
// A generous search limit keeps the pacer's gaps short in tests.
const searchHeaders = () => ({ 'x-ratelimit-limit': '3000', 'x-ratelimit-remaining': '2999', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'search' });
const coreHeaders = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });
const NOW = new Date('2026-10-21T12:00:00Z');
const deadline = () => Date.now() + 30_000;

/** Accounts per created-date range GitHub "has", keyed `from..to`; ranges not listed hold 40. */
let totals: Record<string, number> = {};
const queries: string[] = [];

function serveSearch() {
  server.use(
    http.get(`${API}/search/users`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const q = params.get('q') ?? '';
      queries.push(`${q}#${params.get('page')}`);
      const range = /created:(\S+)/.exec(q)?.[1] ?? '';
      const total = totals[range] ?? 40;
      const page = Number(params.get('page'));
      const perPage = Number(params.get('per_page'));
      const count = Math.max(0, Math.min(perPage, total - (page - 1) * perPage));
      const items = Array.from({ length: count }, (_, index) => {
        const n = (page - 1) * perPage + index + 1;
        const id = Number.parseInt(range.replace(/\D/g, '').slice(0, 9), 10) + n;
        return { id, login: `crawled-${id}`, avatar_url: 'https://x', html_url: 'https://x', type: 'User' };
      });
      return HttpResponse.json({ total_count: total, incomplete_results: false, items }, { headers: searchHeaders() });
    }),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  // A university with a verified member seeds its country.
  const [uni] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Crawl Uni', 'crawl-uni', 'Testland', 'TL', '{}', 'admin', 'c') returning id`;
  const member = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${member}, 'UTC', ${uni!.id}, now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  queries.length = 0;
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 3000, remaining: 2999, reset: reset() } } }),
    ),
  );
  serveSearch();
});

describe('pure helpers', () => {
  it('quotes the seed and halves date ranges', () => {
    expect(cursorQuery({ seed: 'New "York"', createdFrom: '2008-01-01', createdTo: '2026-10-21' })).toBe('location:"New York" created:2008-01-01..2026-10-21');
    expect(middleDay('2008-01-01', '2008-01-05')).toBe('2008-01-03');
    expect(middleDay('2008-01-01', '2008-01-02')).toBe('2008-01-01');
    expect(middleDay('2008-01-01', '2008-01-01')).toBeNull();
  });
});

describe('crawlStep', () => {
  it('seeds a cursor for the country, splits ranges above the search cap until they fit, and indexes accounts', async () => {
    totals = { '2008-01-01..2026-10-21': 5000, '2008-01-01..2017-05-27': 900, '2017-05-28..2026-10-21': 150 };
    const client = githubFor(SERVER_IDENTITY);
    expect(await crawlStep(client, NOW, deadline())).toBe('split');
    expect(await database.sql`select created_from::text, created_to::text, status from crawl_cursors where seed = 'Testland' order by created_from, created_to`).toEqual([
      { created_from: '2008-01-01', created_to: '2017-05-27', status: 'pending' },
      { created_from: '2008-01-01', created_to: '2026-10-21', status: 'done' },
      { created_from: '2017-05-28', created_to: '2026-10-21', status: 'pending' },
    ]);

    // The first account of the first half (ids follow the range's digits in this stub).
    await database.sql`insert into crawl_optouts (github_login) values ('crawled-200801013')`;
    const steps: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const step = await crawlStep(client, NOW, deadline());
      steps.push(step);
      if (step === 'idle') break;
    }
    expect(steps.at(-1)).toBe('idle');
    // 900 + 150 accounts fit under the cap of 1000 per query, minus one opt-out.
    const [indexed] = await database.sql<{ count: string }[]>`select count(*) from gh_users where in_country_index and index_country_code = 'TL'`;
    expect(Number(indexed?.count)).toBe(1049);
    expect(await database.sql`select 1 from gh_users where login = 'crawled-200801013'`).toEqual([]);
    expect(queries[0]).toBe('location:"Testland" created:2008-01-01..2026-10-21 type:user#1');
    const [queued] = await database.sql<{ count: string }[]>`select count(*) from jobs where type = 'crawl_repos'`;
    expect(Number(queued?.count)).toBe(1049);
    expect((await database.sql`select count(*)::int as done from crawl_cursors where status = 'done' and crawled_at is not null`)[0]?.done).toBe(2);
  });

  it('honors an opt-out at once, removing what the index holds', async () => {
    await database.sql`insert into gh_users (github_id, login, in_country_index, index_country_code, fetched_at) values (9001, 'leaving-person', true, 'TL', now())`;
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, fetched_at) values (90011, 9001, 'leaving-person/app', 'app', false, now())`;
    await optOutOfIndex('Leaving-Person');
    expect(await database.sql`select 1 from gh_users where github_id = 9001`).toEqual([]);
    expect(await database.sql`select 1 from gh_repos where github_id = 90011`).toEqual([]);
    expect(await database.sql`select github_login from crawl_optouts where github_login = 'leaving-person'`).toHaveLength(1);
  });

  it('prunes the index back under its limits and stops adding', async () => {
    const [before] = await database.sql<{ count: string }[]>`select count(*) from gh_users where in_country_index and not is_member`;
    const users = Number(before?.count);
    await withSettings({ 'crawler.maxUsers': 100, 'crawler.pruneTargetPct': 0.5 }, async () => {
      expect(await guardStorage()).toBe(false);
    });
    const [after] = await database.sql<{ count: string }[]>`select count(*) from gh_users where in_country_index and not is_member`;
    expect(users).toBeGreaterThan(100);
    expect(Number(after?.count)).toBe(50);
    await withSettings({ 'crawler.maxUsers': 100_000 }, async () => {
      expect(await guardStorage()).toBe(true);
    });
  });
});

describe('crawl_repos', () => {
  it('stores an indexed account’s own repositories as metadata, and drops an account that is gone', async () => {
    await database.sql`insert into gh_users (github_id, login, in_country_index, index_country_code, fetched_at) values (8001, 'has-repos', true, 'TL', now()), (8002, 'gone-person', true, 'TL', now())`;
    const repo = (id: number, fork: boolean) => ({ id, full_name: `has-repos/r${id}`, private: false, fork, size: 1, default_branch: 'main', owner: { id: 8001 }, stargazers_count: 3 });
    server.use(
      http.get(`${API}/users/has-repos/repos`, () => HttpResponse.json([repo(80011, false), repo(80012, true)], { headers: coreHeaders() })),
      http.get(`${API}/users/gone-person/repos`, () => HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: coreHeaders() })),
    );
    await database.sql`delete from jobs where type = 'crawl_repos'`;
    for (const githubId of [8001, 8002]) {
      const [job] = await database.sql<{ id: string }[]>`
        insert into jobs (type, payload, max_attempts, priority) values ('crawl_repos', ${database.sql.json({ githubId })}, 3, 0) returning id`;
      await runTick({ budgetMs: 10_000, onlyJobId: job!.id });
    }
    expect(await database.sql`select github_id::int, expires_at from gh_repos where owner_github_id = 8001`).toEqual([{ github_id: 80011, expires_at: null }]);
    expect(await database.sql`select 1 from gh_users where github_id = 8002`).toEqual([]);
  });
});
