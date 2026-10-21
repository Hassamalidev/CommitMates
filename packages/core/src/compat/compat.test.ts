import { setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import type * as GitHubModule from '@commitmates/github';
import type { GitHubClient, StarredRepo } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestOptions, ProfileSnapshot } from '../profiles/ingest';

const ingestProfile = vi.fn<(login: string, options?: IngestOptions) => Promise<ProfileSnapshot>>();
vi.mock('../profiles/ingest', () => ({ ingestProfile }));
const fetchStarredRepos = vi.fn<(client: GitHubClient, login: string, options: { cap: number }) => Promise<StarredRepo[]>>();
vi.mock('@commitmates/github', async (importOriginal) => ({
  ...(await importOriginal<typeof GitHubModule>()),
  fetchStarredRepos,
}));

const { GitHubNotFoundError } = await import('@commitmates/github');
const { registerAllHandlers } = await import('../handlers');
const { registerAllTools } = await import('../tools/definitions');
const { clearTools, loadToolResult, startToolRun, storeToolResult } = await import('../tools/service');
const { devCardTool } = await import('../persona/jobs');
const { compatTool } = await import('./jobs');
const { compatInputSchema, compatResultSchema } = await import('./schemas');
const { buildCompat, compatSide } = await import('./service');

import type { DevCard } from '../persona/schemas';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const HOUR = 3_600_000;

const hours = (entries: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => entries[hour] ?? 0);

function card(login: string, githubId: number, overrides: Partial<DevCard> = {}): DevCard {
  const hist = hours({ 21: 0.5, 22: 0.5 });
  return {
    login,
    name: null,
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}?v=4`,
    githubId,
    isMember: false,
    timezone: 'UTC',
    timezoneSource: 'utc',
    window: { eventsFrom: '2026-07-16T12:00:00.000Z', eventsTo: '2026-10-14T12:00:00.000Z' },
    languages: [{ name: 'TypeScript', share: 1, color: '#3178c6' }],
    tags: [
      { tag: 'react', weight: 1 },
      { tag: 'postgres', weight: 0.5 },
    ],
    hourHist: hist,
    hourHistUtc: hist,
    topics: ['react', 'web'],
    metrics: {
      nightShare: 0.5,
      morningShare: 0,
      weekendShare: 0.2,
      cv: 1,
      activeDayShare: 0.5,
      longestStreak: 3,
      total365: 300,
      privateIncluded: false,
      events: 40,
      activeDays90: 45,
    },
    labels: [{ key: 'nightOwl', strength: 1.4 }],
    enoughActivity: true,
    reposTruncated: false,
    reposAnalyzed: 4,
    activityScore: 0.5,
    companion: { seed: githubId, speciesKey: 'react', paletteHex: '#3178c6', stage: 2, traits: [] },
    calendar90: [],
    ...overrides,
  };
}

const alice = card('alice-dev', 1001);
const bob = card('bob-dev', 1002, {
  tags: [
    { tag: 'react', weight: 0.5 },
    { tag: 'docker', weight: 1 },
  ],
  topics: ['react', 'devops'],
});

function snapshotOf(login: string, githubId: number): ProfileSnapshot {
  return {
    profile: {
      githubId,
      login,
      name: null,
      avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}?v=4`,
      location: null,
      bio: null,
      company: null,
      blog: null,
      createdAt: '2022-01-01T00:00:00Z',
      followers: 0,
      following: 0,
      publicRepos: 0,
      pinnedRepoIds: [],
      repos: [],
      reposTruncated: false,
      contributions: { total: 0, restricted: 0, totalCommits: 0, days: [] },
    },
    isMember: false,
    events: [],
    dependencies: [],
    manifestsComplete: true,
    fetchedAt: new Date().toISOString(),
  };
}

let database: TestDatabase;

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
  ingestProfile.mockReset();
  fetchStarredRepos.mockReset();
  fetchStarredRepos.mockImplementation((_client, login) =>
    Promise.resolve(
      login === 'alice-dev'
        ? [{ fullName: 'vercel/next.js', topics: ['nextjs'] }, { fullName: 'facebook/react', topics: ['react'] }]
        : [{ fullName: 'facebook/react', topics: ['react'] }],
    ),
  );
  await database.sql`truncate jobs, analysis_cache, metric_samples, salts cascade`;
  clearTools();
  clearHandlers();
  registerAllTools();
  registerAllHandlers();
});

async function cache(...cards: DevCard[]) {
  for (const value of cards) {
    await storeToolResult(devCardTool, { login: value.login }, value, { isMemberSubject: value.isMember, now: new Date() });
  }
}

async function run(input: unknown, budgetMs = 30_000) {
  const started = await startToolRun('compat', input);
  if (started.status !== 'queued') throw new Error('expected a queued run');
  await runTick({ budgetMs, onlyJobId: started.jobId });
  let last: JobEvent | undefined;
  for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
    last = event;
    if (event.event === 'progress' || event.event === 'waiting') break;
  }
  return { jobId: started.jobId, last };
}

describe('input and tool definition', () => {
  it('needs two different people, however they are written', () => {
    expect(compatInputSchema.parse({ a: '@Alice-Dev', b: 'bob-dev' })).toEqual({ a: 'Alice-Dev', b: 'bob-dev' });
    const same = compatInputSchema.safeParse({ a: 'Alice-Dev', b: 'alice-dev' });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]).toMatchObject({ path: ['b'], message: 'Enter two different usernames.' });
    expect(compatInputSchema.safeParse({ a: 'ok', b: 'not valid' }).success).toBe(false);
  });

  it('treats the same two people in either order as one result', () => {
    expect(compatTool.subjectKey({ a: 'Bob-Dev', b: 'alice-dev' })).toBe('alice-dev:bob-dev');
    expect(compatTool.subjectKey({ a: 'alice-dev', b: 'bob-dev' })).toBe('alice-dev:bob-dev');
    expect(compatTool.idempotencyKey({ a: 'bob-dev', b: 'Alice-Dev' }, NOW, {})).toBe('compat:alice-dev:bob-dev:2026-10-14T12');
    expect(compatTool.payload?.({ a: 'x1', b: 'y1' }, { userId: 'u' })).toEqual({ a: 'x1', b: 'y1', requestedBy: 'u' });
  });
});

describe('buildCompat', () => {
  it('scores, bands and explains a pair from real signals', async () => {
    const result = compatResultSchema.parse(
      await buildCompat(
        { card: alice, starred: [{ fullName: 'facebook/react', topics: ['react'] }] },
        { card: bob, starred: [{ fullName: 'facebook/react', topics: ['react'] }] },
      ),
    );
    expect(result.a).toMatchObject({ login: 'alice-dev', githubId: 1001 });
    expect(result.components.rhythm).toBe(1);
    // {react, web} vs {react, devops}: 1 of 3.
    expect(result.components.interest).toBeCloseTo(1 / 3, 12);
    expect(result.score).toBeGreaterThan(0);
    expect(result.band).not.toBeNull();
    expect(result.explanations).toEqual({
      sharedTags: ['react'],
      sharedStars: ['facebook/react'],
      window: { startHourUtc: 21, hours: 2 },
      strengthA: 'postgres',
      strengthB: 'docker',
    });
  });

  it('follows the weights and bands in settings', async () => {
    const pair = [{ card: alice, starred: [] }, { card: alice, starred: [] }] as const;
    const result = await withSettings(
      {
        'compat.weights': { skill: 0, interest: 0, rhythm: 1, complement: 0 },
        'compat.bands': [
          { min: 0, key: 'low' },
          { min: 99, key: 'twins' },
        ],
      },
      () => buildCompat(...pair),
    );
    expect(result.score).toBe(100);
    expect(result.band).toBe('twins');
  });

  it('scores from what exists when one person has too little data', async () => {
    const quiet = card('quiet-dev', 1003, { tags: [], topics: [], hourHistUtc: hours({}), languages: [{ name: 'Go', share: 1, color: null }] });
    const result = await buildCompat({ card: alice, starred: [] }, { card: quiet, starred: [] });
    expect(result.components).toEqual({ skill: 0, interest: null, rhythm: null, complement: null });
    expect(result.score).toBe(0);
  });

  it('merges starred topics into interests', () => {
    expect([...compatSide(alice, [{ fullName: 'x/y', topics: ['react', 'graphql'] }]).topics].sort()).toEqual(['graphql', 'react', 'web']);
  });
});

describe('compat_check job', () => {
  it('reuses cached cards, stores the result and answers the next request from the cache', async () => {
    await cache(alice, bob);
    const { last } = await run({ a: 'bob-dev', b: 'alice-dev' });
    expect(ingestProfile).not.toHaveBeenCalled();
    expect(fetchStarredRepos.mock.calls.map((call) => call[1]).sort()).toEqual(['alice-dev', 'bob-dev']);
    expect(fetchStarredRepos.mock.calls[0]?.[2].cap).toBe(200);

    if (last?.event !== 'done') throw new Error(`expected done, got ${last?.event}`);
    const result = compatResultSchema.parse(await loadToolResult(last.data.resultRef));
    expect(result.a.login).toBe('bob-dev');
    expect(result.explanations.sharedStars).toEqual(['facebook/react']);

    const [row] = await database.sql`select subject_key, is_member_subject, expires_at, computed_at from analysis_cache where kind = 'compat'`;
    expect(row).toMatchObject({ subject_key: 'alice-dev:bob-dev', is_member_subject: false });
    expect(row!.expires_at.getTime() - row!.computed_at.getTime()).toBe(12 * HOUR);
    expect(await startToolRun('compat', { a: 'alice-dev', b: 'bob-dev' })).toMatchObject({ status: 'done' });
  });

  it("builds and caches a card that does not exist yet", async () => {
    await cache(alice);
    // A stale card in the cache (missing fields from an older version) is rebuilt too.
    await storeToolResult(devCardTool, { login: 'bob-dev' }, { login: 'bob-dev' }, { isMemberSubject: false, now: new Date() });
    ingestProfile.mockResolvedValue(snapshotOf('bob-dev', 1002));
    const { last } = await run({ a: 'alice-dev', b: 'bob-dev' });
    expect(last?.event).toBe('done');
    expect(ingestProfile.mock.calls.map((call) => call[0])).toEqual(['bob-dev']);
    const cards = await database.sql`select subject_key from analysis_cache where kind = 'dev_card' order by subject_key`;
    expect(cards.map((row) => row.subject_key)).toEqual(['alice-dev', 'bob-dev']);
  });

  it('names the person it could not find, on their field', async () => {
    await cache(alice);
    ingestProfile.mockRejectedValue(new GitHubNotFoundError('@ghost-dev'));
    const { jobId, last } = await run({ a: 'alice-dev', b: 'ghost-dev' });
    expect(last).toEqual({ event: 'error', data: { message: "We couldn't find @ghost-dev on GitHub. Check the spelling?" } });
    const [job] = await database.sql`select status from jobs where id = ${jobId}`;
    expect(job!.status).toBe('failed');
  });

  it('continues in a follow-up when building the first card used up the time, and never loops', async () => {
    await cache(bob);
    ingestProfile.mockResolvedValue(snapshotOf('alice-dev', 1001));
    const { jobId } = await run({ a: 'alice-dev', b: 'bob-dev' }, 9000);
    const chain = await database.sql`select status from jobs where type = 'compat_check' order by created_at`;
    // The follow-up finds the first card cached, so it finishes even on the same short budget.
    expect(chain.map((job) => job.status)).toEqual(['done', 'done']);
    expect(ingestProfile).toHaveBeenCalledTimes(1);
    let last: JobEvent | undefined;
    for await (const event of watchJob(jobId, { sleep: () => Promise.resolve() })) last = event;
    expect(last?.event).toBe('done');
  });
});
