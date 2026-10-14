import { readFileSync } from 'node:fs';

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

import { fypTool } from './jobs';
import { fypInputSchema, fypResultSchema } from './schemas';

const english = JSON.parse(readFileSync(new URL('../../../algorithms/src/__fixtures__/stopwords/en.json', import.meta.url), 'utf8')) as string[];
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let queries: string[] = [];

const IDEA = {
  title: 'Smart attendance with face recognition',
  description:
    'A smart attendance system that recognizes students with face recognition from a classroom camera, runs on an edge device and shows attendance in a teacher dashboard.',
};

const READMES: Record<string, string> = {
  // Nearly the same project, described in nearly the same words.
  'a/face-attendance':
    '# Smart attendance with face recognition\nA smart attendance system that recognizes students with face recognition from a classroom camera. It runs on an edge device and shows attendance in a teacher dashboard.',
  'b/face-unlock': '# Face unlock\nFace recognition library to unlock a laptop with a webcam.',
  'c/weather': '# Weather\nA weather station that logs temperature and humidity.',
};

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = (resource = 'core', limit = 5000) => ({
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-remaining': String(limit - 10),
  'x-ratelimit-reset': String(reset()),
  'x-ratelimit-resource': resource,
});

function serve() {
  const items = Object.keys(READMES).map((fullName, index) => ({
    id: 300 + index,
    full_name: fullName,
    name: fullName.split('/')[1],
    description: null,
    homepage: null,
    topics: [],
    language: 'Python',
    stargazers_count: 10 * (index + 1),
    forks_count: 0,
    open_issues_count: 0,
    fork: false,
    archived: false,
    default_branch: 'main',
    size: 10,
    license: null,
    created_at: '2024-01-01T00:00:00Z',
    pushed_at: '2025-01-01T00:00:00Z',
    owner: { id: 900 + index, login: fullName.split('/')[0] },
  }));
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } }),
    ),
    http.get(`${API}/search/repositories`, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json({ total_count: items.length, incomplete_results: false, items }, { headers: headers('search', 60000) });
    }),
    http.get(`${API}/repos/:owner/:repo/readme`, ({ params }) => {
      const readme = READMES[`${params.owner as string}/${params.repo as string}`];
      return readme ? new HttpResponse(readme, { headers: { ...headers(), 'content-type': 'text/plain' } }) : HttpResponse.json({}, { status: 404, headers: headers() });
    }),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`insert into stopwords (language, words, checksum, synced_at) values ('en', ${english}, 'x', now()), ('de', ${['und', 'der', 'die', 'das', 'ist']}, 'y', now())`;
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
  await database.sql`truncate jobs, analysis_cache, api_cache, github_budgets cascade`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
});

async function run(input: unknown) {
  const started = await startToolRun('fyp-check', input);
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
  return fypResultSchema.parse(await loadToolResult(last.data.resultRef));
}

describe('input', () => {
  it('needs a title and a description of a useful length', () => {
    expect(fypInputSchema.safeParse(IDEA).success).toBe(true);
    expect(fypInputSchema.safeParse({ ...IDEA, description: 'Too short.' }).error?.issues[0]?.path).toEqual(['description']);
    expect(fypInputSchema.safeParse({ ...IDEA, title: '' }).error?.issues[0]?.path).toEqual(['title']);
    expect(fypInputSchema.safeParse({ ...IDEA, title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('keys the same idea the same way, whatever the spacing or case', () => {
    expect(fypTool.subjectKey(IDEA)).toBe(fypTool.subjectKey({ title: IDEA.title.toUpperCase(), description: `  ${IDEA.description}  ` }));
  });
});

describe('fyp_check job', () => {
  it('finds similar projects, bands them and explains the overlap', async () => {
    serve();
    const result = await run(IDEA);
    expect(result.language).toBe('en');
    expect(result.keyphrases.length).toBeGreaterThan(2);
    expect(queries[0]).toMatch(/^".+" ".+" ".+" in:name,description,readme$/);
    expect(queries.length).toBeGreaterThanOrEqual(1);

    expect(result.results.map((entry) => entry.fullName)).toEqual(['a/face-attendance', 'b/face-unlock', 'c/weather']);
    const [closest, partial, unrelated] = result.results;
    expect(closest?.band).toBe('very-similar');
    expect(closest?.similarity).toBeGreaterThanOrEqual(70);
    expect(partial?.similarity).toBeLessThan(closest?.similarity ?? 0);
    expect(unrelated).toMatchObject({ similarity: 0, band: 'loose', sharedKeyphrases: [] });
    expect(closest?.sharedKeyphrases.length).toBeGreaterThan(0);
    // Phrases that appear in none of the closest projects are what makes the idea different.
    expect(result.unique.every((phrase) => !READMES['a/face-attendance']?.toLowerCase().includes(phrase.toLowerCase()))).toBe(true);
  });

  it('uses the stopwords of the language the idea is written in', async () => {
    serve();
    const result = await run({
      title: 'Die Anwesenheit im Hörsaal',
      description: 'Das ist ein System, das die Anwesenheit der Studierenden im Hörsaal mit einer Kamera erfasst und der Lehrkraft zeigt.',
    });
    expect(result.language).toBe('de');
  });
});
