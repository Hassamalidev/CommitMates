import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState, type CommitSummary } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import { HttpResponse, delay, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { globToRegExp, linguistExclusionPatterns } from './attributes';
import { fairnessTool } from './jobs';
import { fairnessResultSchema } from './schemas';
import { accountKey, assembleContributors, coAuthors, emailKey, weekStart } from './service';

const WEEK_1 = Date.UTC(2026, 8, 6) / 1000; // Sunday 2026-09-06
const WEEK_2 = WEEK_1 + 7 * 86_400;

const commit = (sha: string, overrides: Partial<CommitSummary> = {}): CommitSummary => ({
  sha,
  message: `Change ${sha}`,
  authorName: 'Alice',
  authorEmail: 'alice@example.com',
  date: '2026-09-08T10:00:00Z',
  account: { login: 'alice', githubId: 1, avatarUrl: null, isBot: false },
  isMerge: false,
  ...overrides,
});

describe('gitattributes', () => {
  it('turns globs into anchored expressions', () => {
    expect(globToRegExp('*.min.js').test('static/app.min.js')).toBe(true);
    expect(globToRegExp('*.min.js').test('static/app.js')).toBe(false);
    expect(globToRegExp('docs/').test('docs/guide/intro.md')).toBe(true);
    expect(globToRegExp('/build/*').test('build/out.js')).toBe(true);
    expect(globToRegExp('/build/*').test('src/build/out.js')).toBe(false);
    expect(globToRegExp('**/generated/**').test('a/b/generated/c/d.ts')).toBe(true);
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('a+b(c).txt').test('a+b(c).txt')).toBe(true);
  });

  it('keeps the patterns that set a Linguist attribute', () => {
    const patterns = linguistExclusionPatterns(
      ['# comment', '', '*.pb.go linguist-generated', 'vendor/** linguist-vendored=true', 'docs/** -linguist-documentation', 'keep/** linguist-vendored=false', '*.png binary'].join('\n'),
    );
    expect(patterns.map((pattern) => pattern.test('api/user.pb.go'))).toEqual([true, false]);
    expect(patterns.some((pattern) => pattern.test('vendor/lib/x.js'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('docs/a.md'))).toBe(false);
    expect(patterns.some((pattern) => pattern.test('keep/a.js'))).toBe(false);
  });
});

describe('helpers', () => {
  it('reads co-author trailers and starts weeks on Sunday', () => {
    expect(coAuthors('Pair on login\n\nCo-authored-by: Bob B <bob@example.com>\nco-authored-by: Carol <carol@example.com>')).toEqual([
      { name: 'Bob B', email: 'bob@example.com' },
      { name: 'Carol', email: 'carol@example.com' },
    ]);
    expect(new Date(weekStart(new Date('2026-09-09T23:00:00Z'))).toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(emailKey(' Alice@Example.com ')).toBe(emailKey('alice@example.com'));
    expect(emailKey('alice@example.com')).not.toContain('alice');
  });
});

describe('assembleContributors', () => {
  const stats = [
    { account: { login: 'alice', githubId: 1, avatarUrl: null, isBot: false }, total: 6, weeks: [{ week: WEEK_1, additions: 100, deletions: 10, commits: 4 }, { week: WEEK_2, additions: 50, deletions: 5, commits: 2 }] },
    { account: { login: 'bob', githubId: 2, avatarUrl: null, isBot: false }, total: 2, weeks: [{ week: WEEK_2, additions: 20, deletions: 0, commits: 2 }] },
    { account: { login: 'dependabot[bot]', githubId: 3, avatarUrl: null, isBot: true }, total: 9, weeks: [{ week: WEEK_1, additions: 9, deletions: 9, commits: 9 }] },
  ];

  it('takes accounts from statistics and people without one from commits, on one week axis', () => {
    const { contributors, weeks } = assembleContributors({
      stats,
      commits: [commit('a1'), commit('c1', { account: null, authorName: 'Carol', authorEmail: 'carol@example.com', date: '2026-09-15T09:00:00Z' })],
      reading: { lines: new Map([['c1', [30, 3]]]), excluded: new Map(), files: null },
    });
    expect(weeks).toEqual(['2026-09-06', '2026-09-13']);
    const byKey = Object.fromEntries(contributors.map((person) => [person.key, person]));
    expect(byKey[accountKey(1)]).toMatchObject({ login: 'alice', commits: 6, additions: 150, deletions: 15, weekly: [4, 2] });
    expect(byKey[accountKey(3)]).toMatchObject({ isBot: true });
    expect(byKey[emailKey('carol@example.com')]).toMatchObject({ login: null, name: 'Carol', commits: 1, additions: 30, deletions: 3, weekly: [0, 1] });
  });

  it('credits co-authors with a commit and an equal share of its lines', () => {
    const { contributors, coAuthorCredits } = assembleContributors({
      stats,
      commits: [
        commit('p1', { message: 'Pair\n\nCo-authored-by: Bob <bob@example.com>' }),
        commit('b1', { account: { login: 'bob', githubId: 2, avatarUrl: null, isBot: false }, authorEmail: 'bob@example.com' }),
      ],
      reading: { lines: new Map([['p1', [40, 10]]]), excluded: new Map(), files: null },
    });
    expect(coAuthorCredits).toBe(1);
    const alice = contributors.find((person) => person.key === accountKey(1));
    const bob = contributors.find((person) => person.key === accountKey(2));
    expect(alice).toMatchObject({ commits: 6, additions: 130, deletions: 10 });
    expect(bob).toMatchObject({ commits: 3, additions: 40, deletions: 5 });
  });

  it('subtracts lines in excluded paths and counts files when every commit was read', () => {
    const { contributors } = assembleContributors({
      stats: stats.slice(0, 1),
      commits: [commit('a1')],
      reading: { lines: new Map([['a1', [5, 0]]]), excluded: new Map([[accountKey(1), [100, 0] as const]]), files: new Map([[accountKey(1), new Set(['src/a.ts', 'src/b.ts'])]]) },
    });
    expect(contributors[0]).toMatchObject({ additions: 50, deletions: 15, filesTouched: 2 });
  });

  it('builds everything from commits when there are no statistics, and skips merges', () => {
    const { contributors } = assembleContributors({
      stats: null,
      commits: [commit('a1'), commit('a2', { date: '2026-09-15T09:00:00Z' }), commit('m1', { isMerge: true })],
      reading: { lines: new Map([['a1', [10, 1]], ['a2', [20, 2]]]), excluded: new Map(), files: null },
    });
    expect(contributors).toHaveLength(1);
    expect(contributors[0]).toMatchObject({ commits: 2, additions: 30, deletions: 3, weekly: [1, 1] });
  });

  it('marks lines unknown when a counted commit was not read', () => {
    const { contributors } = assembleContributors({ stats: null, commits: [commit('a1')], reading: { lines: new Map(), excluded: new Map(), files: null } });
    expect(contributors[0]).toMatchObject({ commits: 1, additions: null, deletions: null });
  });
});

describe('fairness_report job', () => {
  const API = 'https://api.github.com';
  const server = createMswServer();
  let database: TestDatabase;
  let statsReady = true;
  let detailRequests: string[] = [];
  let detailDelayMs = 0;

  const headers = () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    return { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' };
  };
  const gitCommit = (sha: string, login: string | null, email: string, message = `Change ${sha}`) => ({
    sha,
    commit: { message, author: { name: login ?? 'Carol', email, date: '2026-09-08T10:00:00Z' } },
    author: login ? { login, id: login === 'alice' ? 1 : 2, avatar_url: null, type: 'User' } : null,
    parents: [{ sha: 'parent' }],
  });

  function serve(repo: Record<string, unknown> = {}) {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    server.use(
      http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset } } })),
      http.get(`${API}/repos/team/project`, () =>
        HttpResponse.json({ id: 77, full_name: 'team/project', private: false, fork: false, size: 100, default_branch: 'main', ...repo }, { headers: headers() }),
      ),
      http.get(`${API}/repos/team/project/stats/contributors`, () =>
        statsReady
          ? HttpResponse.json(
              [
                { author: { login: 'alice', id: 1, type: 'User' }, total: 8, weeks: [{ w: WEEK_1, a: 300, d: 20, c: 8 }] },
                { author: { login: 'bob', id: 2, type: 'User' }, total: 1, weeks: [{ w: WEEK_1, a: 10, d: 0, c: 1 }] },
              ],
              { headers: headers() },
            )
          : new HttpResponse(null, { status: 202, headers: headers() }),
      ),
      http.get(`${API}/repos/team/project/commits`, () =>
        HttpResponse.json([gitCommit('a1', 'alice', 'alice@example.com'), gitCommit('c1', null, 'carol@example.com'), gitCommit('b1', 'bob', 'bob@example.com')], {
          headers: headers(),
        }),
      ),
      http.get(`${API}/repos/team/project/git/trees/main`, () =>
        HttpResponse.json(
          { sha: 'root', truncated: false, tree: [{ path: 'src/app.ts', type: 'blob', sha: 's1', size: 10 }, { path: 'dist/bundle.min.js', type: 'blob', sha: 's2', size: 10 }] },
          { headers: headers() },
        ),
      ),
      http.get(`${API}/repos/team/project/contents/.gitattributes`, () =>
        new HttpResponse('dist/** linguist-generated\n', { headers: { ...headers(), 'content-type': 'text/plain' } }),
      ),
      http.get(`${API}/repos/team/project/commits/:sha`, async ({ params }) => {
        detailRequests.push(String(params.sha));
        if (detailDelayMs > 0) await delay(detailDelayMs);
        return HttpResponse.json(
          {
            files: [
              { filename: 'src/app.ts', additions: 12, deletions: 2 },
              { filename: 'dist/bundle.min.js', additions: 200, deletions: 0 },
            ],
          },
          { headers: headers() },
        );
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
    statsReady = true;
    detailRequests = [];
    detailDelayMs = 0;
    await database.sql`truncate jobs, analysis_cache, fairness_reports, api_cache, github_budgets cascade`;
    clearTools();
    clearHandlers();
    registerAllTools();
    registerAllHandlers();
  });

  async function run(input: unknown, budgetMs = 30_000) {
    const started = await startToolRun('fairness', input);
    if (started.status !== 'queued') throw new Error('expected a queued run');
    await runTick({ budgetMs, onlyJobId: started.jobId });
    let last: JobEvent | undefined;
    for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
      last = event;
      if (event.event === 'progress' || event.event === 'waiting') break;
    }
    return { jobId: started.jobId, last };
  }

  it('keys the report by repository, however the link is written', () => {
    expect(fairnessTool.subjectKey({ repoUrl: 'https://github.com/Team/Project/tree/main' })).toBe('team/project');
    expect(fairnessTool.subjectKey({ repoUrl: 'team/project' })).toBe('team/project');
  });

  it('builds the report, leaving out generated files, and records only team numbers', async () => {
    serve();
    const { last } = await run({ repoUrl: 'https://github.com/team/project' });
    if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
    const result = fairnessResultSchema.parse(await loadToolResult(last.data.resultRef));

    expect(result).toMatchObject({ repo: { fullName: 'team/project', githubId: 77 }, mode: 'stats', excludedPaths: 1, commitsAnalyzed: 3 });
    // An excluded path exists, so every commit was read: 3 × 200 generated lines left out.
    expect(detailRequests.sort()).toEqual(['a1', 'b1', 'c1']);
    expect(result.excludedLines).toBe(600);
    const alice = result.contributors.find((person) => person.login === 'alice');
    expect(alice).toMatchObject({ commits: 8, additions: 100, deletions: 20, filesTouched: 1 });
    expect(result.contributors.find((person) => person.login === null)).toMatchObject({ name: 'Carol', commits: 1, additions: 12 });

    const [summary] = await database.sql`select repo_github_id::int as repo, result from fairness_reports`;
    expect(summary).toMatchObject({ repo: 77, result: { people: 3 } });
    expect(JSON.stringify(summary)).not.toContain('alice');
  });

  it('waits while GitHub is still computing the statistics', async () => {
    statsReady = false;
    serve();
    // No retries inside the run: the job goes straight to waiting.
    const { last } = await withSettings({ 'fairness.statsRetryMax': 0 }, () => run({ repoUrl: 'team/project' }));
    expect(last?.event).toBe('waiting');
  });

  it('continues reading commits in a follow-up when time runs short', async () => {
    serve();
    detailDelayMs = 600;
    // A 6 s budget leaves about one second for reading commits before the margin.
    const { jobId } = await run({ repoUrl: 'team/project' }, 6000);
    detailDelayMs = 0;
    const chain = await database.sql`select status, payload from jobs where type = 'fairness_report' order by created_at`;
    expect(chain.length).toBeGreaterThan(1);
    expect((chain[1]!.payload as { cursor: number }).cursor).toBeGreaterThanOrEqual(0);
    for (let pass = 0; pass < 5; pass += 1) await runTick({ budgetMs: 30_000 });
    let last: JobEvent | undefined;
    for await (const event of watchJob(jobId, { sleep: () => Promise.resolve() })) last = event;
    expect(last?.event).toBe('done');
  });

  it('turns away private repositories and forks of something larger', async () => {
    serve({ private: true });
    expect((await run({ repoUrl: 'team/project' })).last).toEqual({
      event: 'error',
      data: { message: 'That repository is private. Fairness reports work on public repositories.' },
    });
    resetGitHubClientState();
    await database.sql`truncate jobs, api_cache cascade`;
    serve({ fork: true, parent: { full_name: 'origin/project', size: 5000 } });
    expect((await run({ repoUrl: 'team/project' })).last).toEqual({
      event: 'error',
      data: { message: "This is a fork of origin/project. Check the team's own repository instead." },
    });
  });

  it('rejects a link that is not a repository before queueing', async () => {
    await expect(startToolRun('fairness', { repoUrl: 'https://example.com/x' })).rejects.toMatchObject({ field: 'repoUrl' });
  });
});
