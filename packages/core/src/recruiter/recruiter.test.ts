import { createMswServer } from '@commitmates/config/testing/msw';
import { encrypt, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState, type ActivityEvent, type ProfileRepo } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestOptions, ProfileSnapshot } from '../profiles/ingest';
import type { ScanReport } from '../secrets/scanner';

const ingestProfile = vi.fn<(login: string, options?: IngestOptions) => Promise<ProfileSnapshot>>();
vi.mock('../profiles/ingest', () => ({ ingestProfile }));
const scanRepositories = vi.fn<(...args: unknown[]) => Promise<ScanReport>>();
vi.mock('../secrets/scanner', () => ({ scanRepositories }));

const { registerAllHandlers } = await import('../handlers');
const { registerAllTools } = await import('../tools/definitions');
const { clearTools, loadToolResult, startToolRun } = await import('../tools/service');
const { recruiterTool } = await import('./jobs');
const { recruiterResultSchema } = await import('./schemas');
const { showcaseRepos } = await import('./service');

const API = 'https://api.github.com';
const LOGIN = 'fixture-user-1';
const server = createMswServer();
let database: TestDatabase;

const repo = (id: number, name: string, overrides: Partial<ProfileRepo> = {}): ProfileRepo => ({
  githubId: id,
  name,
  fullName: `${LOGIN}/${name}`,
  description: 'A sample repository.',
  homepage: null,
  stars: 0,
  forks: 0,
  isFork: false,
  isArchived: false,
  pushedAt: '2026-10-10T18:30:00Z',
  createdAt: '2025-01-10T09:00:00Z',
  sizeKb: 100,
  defaultBranch: 'main',
  licenseSpdx: 'MIT',
  primaryLanguage: 'TypeScript',
  languages: { TypeScript: 1000 },
  topics: ['react'],
  openIssues: 0,
  ...overrides,
});

const push = (repoName: string, messages: string[]): ActivityEvent => ({
  kind: 'push',
  createdAt: '2026-10-10T18:30:00Z',
  repo: `${LOGIN}/${repoName}`,
  commits: messages.length,
  messages,
});

function snapshot(overrides: { pinned?: number[]; repos?: ProfileRepo[]; events?: ActivityEvent[] } = {}): ProfileSnapshot {
  return {
    profile: {
      githubId: 4242,
      login: LOGIN,
      name: 'Fixture User',
      avatarUrl: 'https://avatars.githubusercontent.com/u/4242?v=4',
      location: null,
      bio: null,
      company: null,
      blog: null,
      createdAt: '2022-01-01T00:00:00Z',
      followers: 1,
      following: 1,
      publicRepos: 3,
      pinnedRepoIds: overrides.pinned ?? [9000, 9001],
      repos: overrides.repos ?? [
        repo(9000, 'campus-map', { homepage: 'https://campus-map.example.org', stars: 14 }),
        repo(9001, 'grade-bot', { licenseSpdx: null, topics: [], description: null, stars: 3 }),
        repo(9002, 'notes', { stars: 30 }),
      ],
      reposTruncated: false,
      contributions: {
        total: 120,
        restricted: 0,
        totalCommits: 100,
        days: Array.from({ length: 90 }, (_, index) => ({
          date: new Date(Date.UTC(2026, 6, 17 + index)).toISOString().slice(0, 10),
          count: index % 2 === 0 ? 1 : 0,
        })),
      },
    },
    isMember: false,
    events: overrides.events ?? [
      push('campus-map', ['Add building search with fuzzy matching', 'fix']),
      push('grade-bot', ['WIP: grade export', 'Handle missing grades without crashing']),
    ],
    dependencies: [],
    manifestsComplete: true,
    fetchedAt: new Date().toISOString(),
  };
}

const READMES: Record<string, string | null> = {
  [`${LOGIN}/${LOGIN}`]: null,
  [`${LOGIN}/campus-map`]: `# Campus map\n${'Find any building on campus. '.repeat(30)}`,
  [`${LOGIN}/grade-bot`]: '# Grade bot\nComing soon.\n- [ ] export to PDF',
  [`${LOGIN}/notes`]: '# Notes',
};

function serveReadmes(readmes: Record<string, string | null> = READMES) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const headers = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' };
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset } } })),
    http.get(`${API}/repos/:owner/:repo/readme`, ({ params }) => {
      const text = readmes[`${String(params.owner)}/${String(params.repo)}`];
      return text === null || text === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404, headers })
        : new HttpResponse(text, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('react', 'React', '{reactjs,react-js}', '{}', 'sha', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(async () => {
  resetGitHubClientState();
  ingestProfile.mockReset();
  scanRepositories.mockReset();
  await database.sql`truncate jobs, analysis_cache, metric_samples, salts, api_cache, github_budgets, generic_message_counts, users cascade`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
  serveReadmes();
});

async function run(input: unknown, userId?: string) {
  const started = await startToolRun('recruiter', input, { userId });
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  if (last?.event !== 'done') throw new Error(`expected done, got ${JSON.stringify(last)}`);
  return recruiterResultSchema.parse(await loadToolResult(last.data.resultRef));
}

const rule = (result: { rules: { key: string }[] }, key: string) => result.rules.find((entry) => entry.key === key);

describe('showcaseRepos', () => {
  it('uses the pinned repositories the person owns, else the top ones by stars', () => {
    expect(showcaseRepos(snapshot(), 6)).toMatchObject({ usedTop: false, repos: [{ name: 'campus-map' }, { name: 'grade-bot' }] });
    // A pinned repository owned by someone else is not in the profile's repositories.
    expect(showcaseRepos(snapshot({ pinned: [123] }), 2)).toMatchObject({ usedTop: true, repos: [{ name: 'notes' }, { name: 'campus-map' }] });
  });
});

describe('recruiter tool definition', () => {
  it('keys a secret-scan run by who asked, and the rest by the claimed skills', () => {
    expect(recruiterTool.params?.({ login: 'x1' }, {})).toEqual({ skills: [] });
    expect(recruiterTool.params?.({ login: 'x1', resumeSkills: ['React', ' go', 'react'] }, {})).toEqual({ skills: ['go', 'react'] });
    expect(recruiterTool.params?.({ login: 'x1', scanSecrets: true }, { userId: 'u1' })).toEqual({ skills: [], scanFor: 'u1' });
    expect(recruiterTool.params?.({ login: 'x1', scanSecrets: true }, {})).toEqual({ skills: [] });
  });
});

describe('recruiter_report job', () => {
  it('scores a visitor’s check with evidence and keeps no secret findings', async () => {
    ingestProfile.mockResolvedValue(snapshot());
    const result = await run({ login: LOGIN });

    expect(result).toMatchObject({ login: LOGIN, isMember: false, usedTopRepos: false, secretScanRan: false });
    expect(rule(result, 'profileReadme')).toMatchObject({ status: 'fail', evidence: { chars: null } });
    expect(rule(result, 'pinnedCount')).toMatchObject({ status: 'pass', evidence: { count: 2 } });
    expect(rule(result, 'pinnedReadme')).toMatchObject({ status: 'partial', evidence: { met: 1, total: 2, source: 'pinned' } });
    expect(rule(result, 'pinnedDemo')).toMatchObject({ evidence: { met: 1, total: 2 } });
    expect(rule(result, 'pinnedLicense')).toMatchObject({ evidence: { met: 1, total: 2 } });
    // Only the bare "fix" says too little.
    expect(rule(result, 'commitMessages')).toMatchObject({ evidence: { informative: 3, total: 4 } });
    // grade-bot's README says "Coming soon" and lists an open task.
    expect(rule(result, 'unfinishedRatio')).toMatchObject({ evidence: { unfinished: 1, examined: 2 } });
    expect(rule(result, 'languageMatch')).toMatchObject({ status: 'not-applicable' });
    expect(rule(result, 'activityConsistency')).toMatchObject({ status: 'pass' });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);

    expect(scanRepositories).not.toHaveBeenCalled();
    expect(await database.sql`select 1 from recruiter_reports`).toHaveLength(0);
    // The Dev Card is built on the way and cached too.
    expect(await database.sql`select kind from analysis_cache order by kind`).toEqual([{ kind: 'dev_card' }, { kind: 'recruiter' }]);
  });

  it('checks claimed skills against verified ones through topic aliases', async () => {
    ingestProfile.mockResolvedValue(snapshot());
    const result = await run({ login: LOGIN, resumeSkills: ['ReactJS', 'TypeScript', 'Kubernetes'] });
    expect(rule(result, 'languageMatch')).toMatchObject({ evidence: { matched: 2, total: 3, missing: ['kubernetes'] } });
  });

  it('counts short commit messages anonymously and treats the most common as generic', async () => {
    ingestProfile.mockResolvedValue(snapshot({ events: [push('campus-map', ['Update readme file', 'Update readme file', 'fix'])] }));
    await run({ login: LOGIN });
    const counts = await database.sql`select message, count from generic_message_counts order by message`;
    expect(counts).toEqual([
      { message: 'fix', count: 1 },
      { message: 'update readme file', count: 1 },
    ]);
    await database.sql`update generic_message_counts set count = 100 where message = 'update readme file'`;
    await database.sql`truncate jobs, analysis_cache cascade`;
    const second = await run({ login: LOGIN });
    expect(rule(second, 'commitMessages')).toMatchObject({ evidence: { informative: 0, total: 3 } });
  });

  it('falls back to the top repositories by stars when nothing is pinned', async () => {
    ingestProfile.mockResolvedValue(snapshot({ pinned: [] }));
    const result = await run({ login: LOGIN });
    expect(result.usedTopRepos).toBe(true);
    expect(rule(result, 'pinnedCount')).toMatchObject({ status: 'fail', evidence: { count: 0 } });
    expect(rule(result, 'pinnedReadme')).toMatchObject({ evidence: { total: 3, source: 'top' } });
  });

  it('scans the owner’s repositories with their own token and stores findings apart from the result', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                       values (${userId}, 4242, ${LOGIN}, ${encrypt('member-token')}, 1)`;
    await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'UTC')`;
    ingestProfile.mockResolvedValue({ ...snapshot(), isMember: true });
    scanRepositories.mockResolvedValue({
      findings: [{ ruleId: 'github-pat', repo: `${LOGIN}/campus-map`, path: 'src/client.ts', line: 4 }],
      filesScanned: 12,
      partial: false,
      rulesAvailable: true,
    });

    const result = await run({ login: LOGIN, scanSecrets: true }, userId);
    expect(result.secretScanRan).toBe(true);
    const [identity, targets] = scanRepositories.mock.calls[0] ?? [];
    expect(identity).toEqual({ kind: 'user', userId });
    // Pinned first, then the rest by stars.
    expect((targets as { name: string }[]).map((target) => target.name)).toEqual(['campus-map', 'grade-bot', 'notes']);

    const [report] = await database.sql`select user_id, subject_github_id::int as subject_github_id, secret_findings, files_scanned, secret_scan_partial from recruiter_reports`;
    expect(report).toMatchObject({ user_id: userId, subject_github_id: 4242, files_scanned: 12, secret_scan_partial: false });
    expect(report!.secret_findings).toEqual([{ ruleId: 'github-pat', repo: `${LOGIN}/campus-map`, path: 'src/client.ts', line: 4 }]);

    // The cached result never says where a secret is.
    const cached = await database.sql`select result::text as result from analysis_cache where kind = 'recruiter'`;
    expect(cached).toHaveLength(1);
    expect(cached[0]!.result).not.toContain('src/client.ts');
    expect(cached[0]!.result).not.toContain('github-pat');

    // A visitor asking about the same account gets their own entry, without the scan.
    const visitor = await run({ login: LOGIN });
    expect(visitor.secretScanRan).toBe(false);
    expect(await database.sql`select 1 from analysis_cache where kind = 'recruiter'`).toHaveLength(2);
  });

  it('never scans when someone else asks for a scan of an account', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                       values (${userId}, 5555, 'someone-else', 'v1.a.b.c', 1)`;
    await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'UTC')`;
    ingestProfile.mockResolvedValue(snapshot());
    const result = await run({ login: LOGIN, scanSecrets: true }, userId);
    expect(result.secretScanRan).toBe(false);
    expect(scanRepositories).not.toHaveBeenCalled();
    expect(await database.sql`select 1 from recruiter_reports`).toHaveLength(0);
  });
});
