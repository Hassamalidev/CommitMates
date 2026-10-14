import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { registerAllTools } from '../tools/definitions';
import { clearTools, loadToolResult, startToolRun } from '../tools/service';

import { ossTool } from './jobs';
import { ossInputSchema, ossResultSchema } from './schemas';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let queries: string[] = [];

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = (resource = 'core', limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(limit - 10),
  'x-ratelimit-reset': String(reset()),
  'x-ratelimit-resource': resource,
});
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

type Repo = { id: number; pushedHoursAgo: number; topics: string[]; replyHours: number | null; labels: string[] };

const REPOS: Record<string, Repo> = {
  'fast/web': { id: 1, pushedHoursAgo: 24, topics: ['react', 'web'], replyHours: 5, labels: ['good first issue', 'bug'] },
  'slow/web': { id: 2, pushedHoursAgo: 24, topics: ['react'], replyHours: 400, labels: ['good first issue'] },
  'old/web': { id: 3, pushedHoursAgo: 24 * 200, topics: ['react'], replyHours: 2, labels: ['good first issue'] },
};

const issue = (repo: string, number: number, comments: number, ageHours: number) => ({
  number,
  title: `Issue ${number} in ${repo}`,
  html_url: `https://github.com/${repo}/issues/${number}`,
  repository_url: `${API}/repos/${repo}`,
  comments,
  created_at: ago(ageHours),
  labels: [{ name: 'good first issue' }, { name: 'bug' }],
});

function serve(found = [issue('fast/web', 1, 0, 48), issue('fast/web', 2, 9, 24), issue('slow/web', 3, 1, 24), issue('old/web', 4, 0, 24)]) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } }),
    ),
    http.get(`${API}/search/issues`, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json({ total_count: found.length, items: found }, { headers: headers('search', 60000) });
    }),
    http.get(`${API}/repos/:owner/:repo`, ({ params }) => {
      const name = `${params.owner as string}/${params.repo as string}`;
      const repo = REPOS[name];
      return repo
        ? HttpResponse.json(
            { id: repo.id, full_name: name, private: false, fork: false, size: 10, default_branch: 'main', topics: repo.topics, language: 'TypeScript', pushed_at: ago(repo.pushedHoursAgo) },
            { headers: headers() },
          )
        : HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() });
    }),
    http.get(`${API}/repos/:owner/:repo/labels`, ({ params }) =>
      HttpResponse.json((REPOS[`${params.owner as string}/${params.repo as string}`]?.labels ?? []).map((name) => ({ name })), { headers: headers() }),
    ),
    http.get(`${API}/repos/:owner/:repo/issues`, () =>
      HttpResponse.json(
        [
          { number: 10, created_at: ago(100), author_association: 'NONE' },
          { number: 11, created_at: ago(100), author_association: 'OWNER' },
        ],
        { headers: headers() },
      ),
    ),
    http.get(`${API}/repos/:owner/:repo/issues/comments`, ({ params }) => {
      const repo = REPOS[`${params.owner as string}/${params.repo as string}`];
      const reply = repo?.replyHours ?? null;
      return HttpResponse.json(
        reply === null
          ? []
          : [
              { issue_url: `${API}/repos/x/y/issues/10`, created_at: ago(100 - reply), author_association: 'MEMBER' },
              { issue_url: `${API}/repos/x/y/issues/10`, created_at: ago(99), author_association: 'NONE' },
            ],
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
  queries = [];
  await database.sql`truncate jobs, analysis_cache, metric_samples, salts, api_cache, github_budgets cascade`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
});

async function run(input: unknown) {
  const started = await startToolRun('oss', input);
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
  return ossResultSchema.parse(await loadToolResult(last.data.resultRef));
}

describe('input', () => {
  it('needs a username or a language', () => {
    expect(ossInputSchema.safeParse({}).success).toBe(false);
    expect(ossInputSchema.safeParse({ languages: [] }).error?.issues[0]?.path).toEqual(['languages']);
    expect(ossInputSchema.safeParse({ languages: ['TypeScript'] }).success).toBe(true);
    expect(ossInputSchema.safeParse({ login: 'someone' }).success).toBe(true);
  });

  it('keys a search by what was asked, in any order', () => {
    expect(ossTool.subjectKey({ languages: ['Python', 'Go'] })).toBe('languages:go,python');
    expect(ossTool.params?.({ languages: ['Go'], topics: ['Web', 'cli'] }, {})).toEqual({ languages: ['go'], topics: ['cli', 'web'] });
  });
});

describe('oss_search job', () => {
  it('finds beginner issues in responsive, recently active projects, best first', async () => {
    serve();
    const result = await run({ languages: ['TypeScript'] });
    expect(queries[0]).toContain('is:issue is:open no:assignee archived:false -linked:pr language:"TypeScript"');
    expect(queries[0]).toContain('label:"good first issue","good-first-issue"');

    // fast/web #2 has too many comments, slow/web answers too slowly, old/web has not been pushed for months.
    expect(result.issues.map((entry) => `${entry.repo}#${entry.number}`)).toEqual(['fast/web#1']);
    expect(result.issues[0]).toMatchObject({ labels: ['good first issue'], skillMatch: 1 });
    // The fixture's timestamps are a few milliseconds apart.
    expect(result.issues[0]?.responseHours).toBeCloseTo(5, 2);
    expect(result.relaxed).toEqual([]);

    // Each project's responsiveness is an anonymous sample for the computed threshold.
    const samples = await database.sql`select metric_key, value from metric_samples order by value`;
    expect(samples.map((row) => Math.round(row.value as number))).toEqual([2, 5, 400]);
  });

  it('relaxes the gates in order and says so when nothing passes', async () => {
    serve([issue('fast/web', 2, 9, 24)]);
    const result = await run({ languages: ['TypeScript'] });
    expect(result.relaxed).toEqual(['comments']);
    expect(result.issues).toHaveLength(1);

    await database.sql`truncate jobs, analysis_cache cascade`;
    serve([issue('slow/web', 5, 9, 24)]);
    const slower = await withSettings({ 'oss.maxComments': 3 }, () => run({ languages: ['TypeScript'], topics: [] }));
    expect(slower.relaxed).toEqual(['comments', 'responsiveness']);
  });

  it('searches each picked language, at most three', async () => {
    serve([]);
    await run({ languages: ['TypeScript', 'Go', 'Rust', 'Python'] });
    expect(queries.map((query) => /language:"([^"]+)"/.exec(query)?.[1])).toEqual(['TypeScript', 'Go', 'Rust']);
  });
});
