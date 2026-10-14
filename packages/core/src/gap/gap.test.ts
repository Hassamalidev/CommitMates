import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { describeFacet, gapTool } from './jobs';
import { gapResultSchema } from './schemas';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let peerReads: string[] = [];

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = (resource = 'core', limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(limit - 10),
  'x-ratelimit-reset': String(reset()),
  'x-ratelimit-resource': resource,
});

type Layout = { files: string[]; dirs: string[]; workflows?: boolean; stars?: number; releases?: boolean };

const LAYOUTS: Record<string, Layout> = {
  'me/app': { files: ['README.md', 'requirements.txt'], dirs: ['src'] },
  'a/one': { files: ['README.md', 'Dockerfile'], dirs: ['src', 'tests', '.github'], workflows: true, stars: 500, releases: true },
  'b/two': { files: ['README.md', 'Dockerfile'], dirs: ['tests', '.github'], workflows: true, stars: 300 },
  'c/three': { files: ['README.md', 'Dockerfile'], dirs: ['tests', '.github'], workflows: true, stars: 200 },
  'd/four': { files: ['README.md', 'LICENSE'], dirs: ['tests'], stars: 100 },
};

const searchItem = (fullName: string, index: number) => ({
  id: 200 + index,
  full_name: fullName,
  name: fullName.split('/')[1],
  description: 'Vision tool',
  homepage: null,
  topics: ['computer-vision'],
  language: 'Python',
  stargazers_count: LAYOUTS[fullName]?.stars ?? 10,
  forks_count: 1,
  open_issues_count: 0,
  fork: false,
  archived: false,
  default_branch: 'main',
  size: 100,
  license: { spdx_id: 'MIT' },
  created_at: '2023-01-01T00:00:00Z',
  pushed_at: new Date().toISOString(),
  owner: { id: 7000 + index, login: fullName.split('/')[0] },
});

function serve(peers = ['a/one', 'b/two', 'c/three', 'd/four'], self: Record<string, unknown> = {}) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } }),
    ),
    http.get(`${API}/repos/me/app`, () =>
      HttpResponse.json(
        {
          id: 1,
          full_name: 'me/app',
          name: 'app',
          private: false,
          fork: false,
          size: 50,
          default_branch: 'main',
          owner: { id: 99 },
          description: 'My vision app',
          topics: ['computer-vision'],
          language: 'Python',
          stargazers_count: 2,
          license: null,
          ...self,
        },
        { headers: headers() },
      ),
    ),
    http.get(`${API}/search/repositories`, () =>
      HttpResponse.json({ total_count: peers.length, incomplete_results: false, items: [searchItem('me/app', 99), ...peers.map(searchItem)] }, { headers: headers('search', 60000) }),
    ),
    http.get(`${API}/repos/:owner/:repo/contents`, ({ params }) => {
      const fullName = `${params.owner as string}/${params.repo as string}`;
      if (fullName !== 'me/app') peerReads.push(fullName);
      const layout = LAYOUTS[fullName] ?? { files: [], dirs: [] };
      return HttpResponse.json(
        [
          ...layout.files.map((name) => ({ name, path: name, type: 'file', sha: `${fullName}:${name}`, size: 10 })),
          ...layout.dirs.map((name) => ({ name, path: name, type: 'dir', sha: `${fullName}:${name}`, size: 0 })),
        ],
        { headers: headers() },
      );
    }),
    http.get(`${API}/repos/:owner/:repo/contents/.github/workflows`, ({ params }) => {
      const layout = LAYOUTS[`${params.owner as string}/${params.repo as string}`];
      return layout?.workflows
        ? HttpResponse.json([{ name: 'ci.yml', path: '.github/workflows/ci.yml', type: 'file', sha: 'wf', size: 10 }], { headers: headers() })
        : HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() });
    }),
    http.get(`${API}/repos/:owner/:repo/contents/requirements.txt`, () => new HttpResponse('numpy\n', { headers: { ...headers(), 'content-type': 'text/plain' } })),
    http.get(`${API}/repos/:owner/:repo/releases`, ({ params }) =>
      HttpResponse.json(LAYOUTS[`${params.owner as string}/${params.repo as string}`]?.releases ? [{ id: 1 }] : [], { headers: headers() }),
    ),
    http.get(`${API}/repos/:owner/:repo/tags`, () => HttpResponse.json([], { headers: headers() })),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('docker', 'Docker', '{dockerfile}', '{}', 'sha', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(async () => {
  resetGitHubClientState();
  peerReads = [];
  await database.sql`truncate jobs, analysis_cache, gap_reports, gh_repos, repo_paths, repo_manifests, repo_dependencies, api_cache, github_budgets, taxonomy_expansions cascade`;
  await database.sql`
    insert into taxonomy_expansions (term, slug, items, sample_size, computed_at, expires_at)
    values ('computer-vision', 'computer-vision', ${database.sql.json([{ kind: 'topic', value: 'computer-vision', score: 1, source: 'alias' }])}, 10, now(), now() + interval '1 day')`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
});

async function run(input: unknown) {
  const started = await startToolRun('gap', input);
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  return last;
}

describe('describeFacet', () => {
  const names = { displayNames: new Map([['docker', 'Docker']]), aliasToSlug: new Map([['docker', 'docker'], ['dockerfile', 'docker']]) };
  const entry = (facet: string) => ({ facet, prevalence: 0.8, peersWith: 4 });

  it('labels paths, tags and repository properties, with a matching topic when there is one', () => {
    expect(describeFacet(entry('file:dockerfile'), names)).toMatchObject({ kind: 'path', name: 'dockerfile', topic: 'Docker' });
    expect(describeFacet(entry('dir:.docker'), names)).toMatchObject({ kind: 'path', topic: 'Docker' });
    expect(describeFacet(entry('dir:tests'), names)).toMatchObject({ kind: 'path', name: 'tests', topic: null });
    expect(describeFacet(entry('tag:docker'), names)).toMatchObject({ kind: 'tag', topic: 'Docker' });
    expect(describeFacet(entry('meta:license'), names)).toMatchObject({ kind: 'meta', name: 'license', topic: null });
  });

  it('keys the tool by repository and day', () => {
    expect(gapTool.subjectKey({ repoUrl: 'https://github.com/Me/App' })).toBe('me/app');
  });
});

describe('gap_analysis job', () => {
  it('compares the repository with similar ones and lists what most of them have', async () => {
    serve();
    const last = await run({ repoUrl: 'https://github.com/me/app' });
    if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
    const result = gapResultSchema.parse(await loadToolResult(last.data.resultRef));

    expect(result.repo.fullName).toBe('me/app');
    expect(result.peers.map((peer) => peer.fullName)).toEqual(['a/one', 'b/two', 'c/three', 'd/four']);
    expect(result.gaps.map((gap) => [gap.facet, gap.prevalence])).toEqual([
      ['dir:tests', 1],
      ['meta:license', 1],
      ['dir:.github', 0.75],
      ['dir:.github/workflows', 0.75],
      ['file:dockerfile', 0.75],
    ]);
    expect(result.gaps.find((gap) => gap.facet === 'file:dockerfile')).toMatchObject({ topic: 'Docker', peersWith: 3, examples: ['a/one', 'b/two', 'c/three'] });
    expect(result.shared.map((entry) => entry.facet)).toEqual(['file:readme.md', 'meta:description', 'meta:topics']);
    // 4 peers against a sample size of 30: below a third, so low confidence.
    expect(result.lowConfidence).toBe(true);

    const [report] = await database.sql`select repo_github_id::int as repo, peer_repo_ids from gap_reports`;
    expect(report?.repo).toBe(1);
    expect(await database.sql`select path_feature from repo_paths where repo_github_id = 1 order by path_feature`).toEqual([
      { path_feature: 'dir:src' },
      { path_feature: 'file:readme.md' },
      { path_feature: 'file:requirements.txt' },
    ]);
  });

  it('reuses cached peer facets on the next analysis', async () => {
    serve();
    await run({ repoUrl: 'me/app' });
    expect(peerReads.length).toBeGreaterThan(0);
    peerReads = [];
    await database.sql`truncate jobs`;
    await database.sql`delete from analysis_cache where kind = 'gap'`;
    serve();
    await run({ repoUrl: 'me/app' });
    expect(peerReads).toEqual([]);
  });

  it('explains private and empty repositories', async () => {
    serve(undefined, { private: true });
    expect(await run({ repoUrl: 'me/app' })).toEqual({ event: 'error', data: { message: 'That repository is private. The Gap Finder works on public repositories.' } });
    resetGitHubClientState();
    await database.sql`truncate jobs, analysis_cache, api_cache cascade`;
    LAYOUTS['me/app'] = { files: [], dirs: [] };
    try {
      serve();
      expect(await run({ repoUrl: 'me/app' })).toEqual({ event: 'error', data: { message: 'That repository is empty, so there is nothing to compare yet.' } });
    } finally {
      LAYOUTS['me/app'] = { files: ['README.md', 'requirements.txt'], dirs: ['src'] };
    }
  });
});
