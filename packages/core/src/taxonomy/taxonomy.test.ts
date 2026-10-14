import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { SERVER_IDENTITY, githubFor, resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { requestExpansion } from './jobs';
import { computeExpansion, getCachedExpansion } from './service';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let searches: string[] = [];

const reset = () => Math.floor(Date.now() / 1000) + 3600;
// A generous search limit keeps the pacer's gap between searches to a millisecond in tests.
const searchHeaders = () => ({ 'x-ratelimit-limit': '60000', 'x-ratelimit-remaining': '59000', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'search' });
const coreHeaders = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });

const repo = (id: number, topics: string[]) => ({
  id,
  full_name: `owner${id}/repo${id}`,
  name: `repo${id}`,
  description: 'A vision project',
  homepage: null,
  topics,
  language: 'Python',
  stargazers_count: 10,
  forks_count: 1,
  open_issues_count: 0,
  fork: false,
  archived: false,
  default_branch: 'main',
  size: 10,
  license: { spdx_id: 'MIT' },
  created_at: '2024-01-01T00:00:00Z',
  pushed_at: '2026-09-01T00:00:00Z',
  owner: { id: 5000 + id, login: `owner${id}` },
});

const TOPIC_TOTALS: Record<string, number> = { 'computer-vision': 20_000, opencv: 8000, python: 900_000, 'image-processing': 15_000 };

function serve(sample = [repo(1, ['opencv', 'python']), repo(2, ['opencv', 'image-processing']), repo(3, ['python']), repo(4, ['opencv'])]) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({
        resources: { core: { limit: 5000, remaining: 4900, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } },
      }),
    ),
    http.get(`${API}/search/repositories`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? '';
      searches.push(q);
      const topic = /^topic:(\S+)$/.exec(q)?.[1];
      if (topic) return HttpResponse.json({ total_count: TOPIC_TOTALS[topic] ?? 100, incomplete_results: false, items: [] }, { headers: searchHeaders() });
      return HttpResponse.json({ total_count: sample.length, incomplete_results: false, items: sample }, { headers: searchHeaders() });
    }),
    http.get(`${API}/repos/:owner/:repo/contents`, ({ params }) =>
      HttpResponse.json(
        params.repo === 'repo1' || params.repo === 'repo2'
          ? [{ name: 'requirements.txt', path: 'requirements.txt', type: 'file', sha: `req-${params.repo as string}`, size: 40 }]
          : [],
        { headers: coreHeaders() },
      ),
    ),
    http.get(`${API}/repos/:owner/:repo/contents/requirements.txt`, ({ params }) =>
      new HttpResponse(params.repo === 'repo1' ? 'opencv-python\nnumpy\n' : 'opencv-python\n', { headers: { ...coreHeaders(), 'content-type': 'text/plain' } }),
    ),
  );
}

const context = (deadline = Date.now() + 30_000) => ({ client: githubFor(SERVER_IDENTITY), now: new Date(), deadline });

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('computer-vision', 'Computer vision', '{cv,machine-vision}', '{image-processing}', 'sha', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearHandlers();
});
beforeEach(async () => {
  resetGitHubClientState();
  searches = [];
  await database.sql`truncate taxonomy_expansions, topic_global_counts, gh_repos, repo_manifests, repo_dependencies, api_cache, github_budgets, jobs, package_meta cascade`;
});

describe('computeExpansion', () => {
  it('seeds aliases and related topics, then learns co-occurring topics and dependencies', async () => {
    serve();
    const run = await computeExpansion('Computer Vision', context());
    if (run.status !== 'done') throw new Error('expected a finished expansion');
    const { expansion } = run;
    expect(expansion).toMatchObject({ term: 'computer vision', slug: 'computer-vision', sampleSize: 4 });
    expect(searches).toContain('computer vision in:name,description,readme');
    expect(searches).toContain('topic:computer-vision');

    const items = expansion.items.map((item) => `${item.kind}:${item.value}:${item.source}`);
    expect(items.slice(0, 4)).toEqual([
      'topic:computer-vision:alias',
      'topic:cv:alias',
      'topic:machine-vision:alias',
      'topic:image-processing:related',
    ]);
    // opencv is in 3 of 4 repos and much rarer on GitHub than python.
    const learned = expansion.items.filter((item) => item.source === 'cooccurrence');
    expect(learned[0]).toMatchObject({ kind: 'topic', value: 'opencv' });
    expect(learned.map((item) => item.value)).toContain('python');
    // Dependencies from the manifests of the top repositories, scored on the sample until the corpus is large.
    expect(learned.find((item) => item.value === 'opencv-python')).toMatchObject({ kind: 'dependency', score: 0.5 });
  });

  it('caches topic counts and the expansion itself', async () => {
    serve();
    await computeExpansion('computer vision', context());
    const counted = await database.sql`select slug, total_count from topic_global_counts order by slug`;
    expect(counted.map((row) => row.slug)).toEqual(['image-processing', 'opencv', 'python']);

    searches = [];
    const again = await computeExpansion('COMPUTER  vision', context());
    expect(again.status).toBe('done');
    expect(searches).toEqual([]);
    expect((await getCachedExpansion('computer vision'))?.items.length).toBeGreaterThan(4);
    expect(await getCachedExpansion('unknown term')).toBeNull();
    expect(await getCachedExpansion('x')).toBeNull();
  });

  it('scores dependencies against the corpus once it is large enough', async () => {
    serve();
    const run = await withSettings({ 'taxonomy.minCorpus': 1 }, () => computeExpansion('vision', context()));
    if (run.status !== 'done') throw new Error('expected a finished expansion');
    const numpy = run.expansion.items.find((item) => item.value === 'numpy');
    const opencv = run.expansion.items.find((item) => item.value === 'opencv-python');
    // Both are used by repositories in the corpus; the rarer one scores higher per sample share.
    expect(numpy?.score).toBeGreaterThan(0);
    expect(opencv?.score).toBeGreaterThan(0);
  });

  it('returns only the alias seeds when the search finds nothing', async () => {
    serve([]);
    const run = await computeExpansion('computer vision', context());
    if (run.status !== 'done') throw new Error('expected a finished expansion');
    expect(run.expansion.items.every((item) => item.source !== 'cooccurrence')).toBe(true);
    expect(run.expansion.sampleSize).toBe(0);
  });

  it('stops early near the deadline and finishes on the next run', async () => {
    serve();
    expect(await computeExpansion('vision', context(Date.now() + 1000))).toEqual({ status: 'partial' });
    expect((await computeExpansion('vision', context())).status).toBe('done');
  });

  it('rejects terms that are too short', async () => {
    await expect(computeExpansion('a', context())).rejects.toMatchObject({ code: 'taxonomy.term_too_short' });
  });
});

describe('taxonomy_expand job', () => {
  it('runs once per term and day through the queue', async () => {
    serve();
    registerAllHandlers();
    await requestExpansion('Computer Vision');
    await requestExpansion('computer vision');
    await requestExpansion('x');
    const jobs = await database.sql`select type, payload from jobs`;
    expect(jobs).toEqual([{ type: 'taxonomy_expand', payload: { term: 'computer vision' } }]);
    await runTick({ budgetMs: 30_000 });
    expect(await getCachedExpansion('computer vision')).not.toBeNull();
  });
});
