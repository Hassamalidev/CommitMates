import { createMswServer } from '@commitmates/config/testing/msw';
import { clearSettingsCache, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { graveyardTool } from './jobs';
import { graveyardResultSchema } from './schemas';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let requests: string[] = [];

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = (resource = 'core', limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(limit - 10),
  'x-ratelimit-reset': String(reset()),
  'x-ratelimit-resource': resource,
});
const monthsAgo = (months: number) => new Date(Date.now() - months * 30.44 * 86_400_000).toISOString();

type Fixture = {
  name: string;
  pushedMonthsAgo: number;
  stars?: number;
  forks?: number;
  openIssues?: number;
  topics?: string[];
  license?: string | null;
  fork?: boolean;
  size?: number;
  readme?: string | null;
  commits?: number;
  messages?: string[];
  releases?: boolean;
  issues?: { state: string; comments: number }[];
};

const FIXTURES: Fixture[] = [
  {
    name: 'half-vision',
    pushedMonthsAgo: 14,
    stars: 40,
    openIssues: 6,
    topics: ['computer-vision', 'opencv'],
    readme: '# Half vision\nWork in progress.\n- [ ] add webcam support',
    commits: 30,
    messages: ['WIP: tracker', 'todo: tests'],
    issues: [{ state: 'open', comments: 0 }, { state: 'open', comments: 2 }],
  },
  {
    name: 'done-vision',
    pushedMonthsAgo: 30,
    stars: 400,
    forks: 50,
    openIssues: 1,
    topics: ['computer-vision'],
    readme: '# Done\n## Installation\npip install done',
    commits: 200,
    releases: true,
    issues: Array.from({ length: 8 }, () => ({ state: 'closed', comments: 1 })),
  },
  { name: 'no-license', pushedMonthsAgo: 10, stars: 5, topics: ['opencv'], license: null, readme: '# Tiny\nComing soon', commits: 8 },
  { name: 'active', pushedMonthsAgo: 1, stars: 99, topics: ['computer-vision'], readme: '# Active', commits: 50 },
  { name: 'fork', pushedMonthsAgo: 12, fork: true, readme: '# Fork', commits: 50 },
  { name: 'no-readme', pushedMonthsAgo: 12, readme: null, commits: 50 },
  { name: 'tiny-history', pushedMonthsAgo: 12, readme: '# Tiny history', commits: 2 },
];

const searchItem = (fixture: Fixture, index: number) => ({
  id: 100 + index,
  full_name: `someone/${fixture.name}`,
  name: fixture.name,
  description: `${fixture.name} project`,
  homepage: null,
  topics: fixture.topics ?? [],
  language: 'Python',
  stargazers_count: fixture.stars ?? 0,
  forks_count: fixture.forks ?? 0,
  open_issues_count: fixture.openIssues ?? 0,
  fork: fixture.fork ?? false,
  archived: false,
  default_branch: 'main',
  size: fixture.size ?? 100 + index * 10,
  license: fixture.license === null ? null : { spdx_id: fixture.license ?? 'MIT' },
  created_at: '2023-01-01T00:00:00Z',
  pushed_at: monthsAgo(fixture.pushedMonthsAgo),
  owner: { id: 900, login: 'someone' },
});

function serve(fixtures: Fixture[] = FIXTURES) {
  const byName = new Map(fixtures.map((fixture) => [fixture.name, fixture]));
  const fixture = (params: Record<string, unknown>) => byName.get(params.repo as string);
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } }),
    ),
    http.get(`${API}/search/repositories`, ({ request }) => {
      requests.push(`search:${new URL(request.url).searchParams.get('q') ?? ''}`);
      return HttpResponse.json({ total_count: fixtures.length, incomplete_results: false, items: fixtures.map(searchItem) }, { headers: headers('search', 60000) });
    }),
    http.get(`${API}/repos/:owner/:repo/readme`, ({ params }) => {
      requests.push(`readme:${params.repo as string}`);
      const readme = fixture(params)?.readme;
      return readme ? new HttpResponse(readme, { headers: { ...headers(), 'content-type': 'text/plain' } }) : HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() });
    }),
    http.get(`${API}/repos/:owner/:repo/contributors`, ({ params }) => HttpResponse.json([{ contributions: fixture(params)?.commits ?? 0 }], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/commits`, ({ params }) =>
      HttpResponse.json((fixture(params)?.messages ?? ['Initial commit']).map((message) => ({ commit: { message, author: { date: '2025-01-01T00:00:00Z' } } })), {
        headers: headers(),
      }),
    ),
    http.get(`${API}/repos/:owner/:repo/releases`, ({ params }) => HttpResponse.json(fixture(params)?.releases ? [{ id: 1 }] : [], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/tags`, () => HttpResponse.json([], { headers: headers() })),
    http.get(`${API}/repos/:owner/:repo/issues`, ({ params }) =>
      HttpResponse.json((fixture(params)?.issues ?? []).map((issue, index) => ({ ...issue, created_at: `2025-0${(index % 9) + 1}-01T00:00:00Z` })), {
        headers: headers(),
      }),
    ),
    http.get(`${API}/repos/:owner/:repo/stargazers`, ({ params }) => {
      requests.push(`stars:${params.repo as string}`);
      return HttpResponse.json([{ starred_at: new Date().toISOString() }, { starred_at: '2020-01-01T00:00:00Z' }], { headers: headers() });
    }),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(async () => {
  resetGitHubClientState();
  requests = [];
  await database.sql`truncate jobs, analysis_cache, taxonomy_expansions, api_cache, github_budgets cascade`;
  await database.sql`delete from settings where key like 'graveyard.idleMonths.%' and key <> 'graveyard.idleMonths.default'`;
  // A cached expansion of the term, so the test reads only the Graveyard's own requests.
  await database.sql`
    insert into taxonomy_expansions (term, slug, items, sample_size, computed_at, expires_at)
    values ('computer vision', 'computer-vision',
            ${database.sql.json([
              { kind: 'topic', value: 'computer-vision', score: 1, source: 'alias' },
              { kind: 'topic', value: 'opencv', score: 2, source: 'cooccurrence' },
            ])}, 50, now(), now() + interval '1 day')`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
});

async function run(input: unknown) {
  const started = await startToolRun('graveyard', input);
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
  return graveyardResultSchema.parse(await loadToolResult(last.data.resultRef));
}

describe('graveyard tool', () => {
  it('keys a search by scope and normalized query, and only searches everywhere for now', () => {
    expect(graveyardTool.subjectKey({ q: '  Computer   Vision ', scope: 'global' })).toBe('global:computer vision');
    expect(graveyardTool.payload?.({ q: 'Computer  Vision', scope: 'global' }, {})).toEqual({ q: 'computer vision', scope: 'global' });
  });

  it('rejects locked scopes and short queries before queueing', async () => {
    await expect(startToolRun('graveyard', { q: 'computer vision', scope: 'country' })).rejects.toMatchObject({ field: 'scope' });
    await expect(startToolRun('graveyard', { q: 'x' })).rejects.toMatchObject({ field: 'q' });
  });
});

describe('graveyard_search job', () => {
  it('finds inactive, revivable projects and explains why they are there', async () => {
    serve();
    const result = await run({ q: 'Computer Vision' });
    expect(result.terms).toEqual(['computer-vision', 'opencv']);
    expect(requests.find((entry) => entry.startsWith('search:'))).toMatch(/^search:computer vision in:name,description,readme fork:false pushed:<\d{4}-\d{2}-\d{2}$/);
    expect(requests).toContain(`search:topic:computer-vision fork:false pushed:<${requests[0]?.slice(-10) ?? ''}`);

    const names = result.items.map((item) => item.fullName);
    expect(names.sort()).toEqual(['someone/done-vision', 'someone/half-vision', 'someone/no-license']);
    // The active project, the fork, the one without a README and the one with two commits are filtered out.
    expect(requests).not.toContain('readme:active');
    expect(requests).not.toContain('readme:fork');

    const half = result.items.find((item) => item.fullName === 'someone/half-vision');
    expect(half).toMatchObject({ category: 'computer-vision', signals: { readmeUnfinished: true, unansweredIssues: 0.5, noReleases: true } });
    expect(half?.unfinished).toBeGreaterThan(0.5);
    const done = result.items.find((item) => item.fullName === 'someone/done-vision');
    expect(done?.unfinished).toBeLessThan(0.3);
    const noLicense = result.items.find((item) => item.fullName === 'someone/no-license');
    expect(noLicense?.licenseSpdx).toBeNull();
    // Ranked by relevance × revivability.
    expect([...result.items].sort((a, b) => b.rank - a.rank)).toEqual(result.items);
  });

  it('reads recent stars only for the top candidates, and caches every signal', async () => {
    serve();
    await withSettings({ 'graveyard.deepScoreTopN': 1 }, () => run({ q: 'computer vision' }));
    expect(requests.filter((entry) => entry.startsWith('stars:'))).toEqual(['stars:half-vision']);

    requests = [];
    // Drop the search result but keep each repository's cached signals.
    await database.sql`truncate jobs`;
    await database.sql`delete from analysis_cache where kind = 'graveyard'`;
    serve();
    await run({ q: 'computer vision' });
    expect(requests.filter((entry) => entry.startsWith('readme:'))).toEqual([]);
  });

  it('uses a per-category idle threshold once one exists', async () => {
    serve();
    await database.sql`
      insert into settings (key, value_type, default_value, description)
      values ('graveyard.idleMonths.computer-vision', 'number', '20'::jsonb, 'Idle threshold for computer-vision')`;
    clearSettingsCache();
    const result = await run({ q: 'computer vision' });
    // half-vision (14 months idle) is now too recent for its category; done-vision (30) still qualifies.
    expect(result.items.map((item) => item.fullName).sort()).toEqual(['someone/done-vision', 'someone/no-license']);
  });

  it('suggests broader terms when nothing qualifies', async () => {
    serve([FIXTURES[3]!]);
    const result = await run({ q: 'computer vision' });
    expect(result.items).toEqual([]);
    expect(result.suggestions).toEqual(['opencv']);
  });
});
