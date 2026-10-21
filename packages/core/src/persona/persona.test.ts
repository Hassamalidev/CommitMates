import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { GitHubNotFoundError, GitHubOrganizationError, type ActivityEvent, type ProfileRepo } from '@commitmates/github';
import { clearHandlers, runTick, watchJob, type JobEvent } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IngestOptions, ProfileSnapshot } from '../profiles/ingest';

const ingestProfile = vi.fn<(login: string, options?: IngestOptions) => Promise<ProfileSnapshot>>();
vi.mock('../profiles/ingest', () => ({ ingestProfile }));

const { registerAllHandlers } = await import('../handlers');
const { registerAllTools } = await import('../tools/definitions');
const { clearTools, loadToolResult, startToolRun } = await import('../tools/service');
const { devCardTool } = await import('./jobs');
const { devCardInputSchema, devCardSchema, loginSchema } = await import('./schemas');
const { buildDevCard, recordPersonaSamples, resolveTimezone } = await import('./service');

const NOW = new Date('2026-10-14T12:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;

const repo = (id: number, name: string, languages: Record<string, number>, topics: string[]): ProfileRepo => ({
  githubId: id,
  name,
  fullName: `fixture-user-1/${name}`,
  description: null,
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
  primaryLanguage: Object.keys(languages)[0] ?? null,
  languages,
  topics,
  openIssues: 0,
});

/** A year of days ending today; the last 90 alternate between two contributions and none. */
const calendar = () =>
  Array.from({ length: 365 }, (_, index) => {
    const age = 364 - index;
    const date = new Date(NOW.getTime() - age * DAY).toISOString().slice(0, 10);
    return { date, count: age < 90 ? (age % 2 === 0 ? 2 : 0) : 0 };
  });

/** Pushes at 18:00 UTC, which is 23:00 in Karachi. */
const eveningEvents = (count: number): ActivityEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'push' as const,
    createdAt: new Date(Date.parse('2026-10-13T18:05:00Z') - index * DAY).toISOString(),
    repo: 'fixture-user-1/campus-map',
    commits: 1,
    messages: ['Add building search'],
  }));

function snapshotOf(overrides: Partial<ProfileSnapshot> & { repos?: ProfileRepo[]; total?: number } = {}): ProfileSnapshot {
  const { repos, total, ...rest } = overrides;
  return {
    profile: {
      githubId: 4242,
      login: 'fixture-user-1',
      name: 'Fixture User',
      avatarUrl: 'https://avatars.githubusercontent.com/u/4242?v=4',
      location: 'Lahore, Pakistan',
      bio: null,
      company: null,
      blog: null,
      createdAt: '2022-03-01T12:00:00Z',
      followers: 12,
      following: 8,
      publicRepos: 3,
      pinnedRepoIds: [],
      repos: repos ?? [
        repo(9000, 'campus-map', { TypeScript: 52_000, CSS: 6000 }, ['react', 'maps']),
        repo(9001, 'grade-bot', { Python: 30_000 }, ['discord-bot']),
        repo(9002, 'notes', {}, []),
      ],
      reposTruncated: false,
      contributions: { total: total ?? 99, restricted: 0, totalCommits: 80, days: calendar() },
    },
    isMember: false,
    events: eveningEvents(20),
    dependencies: [
      { repoGithubId: 9000, ecosystem: 'npm', name: 'react', isDev: false },
      { repoGithubId: 9000, ecosystem: 'npm', name: 'leaflet', isDev: false },
      { repoGithubId: 9001, ecosystem: 'pypi', name: 'discord-py', isDev: false },
    ],
    manifestsComplete: true,
    fetchedAt: NOW.toISOString(),
    ...rest,
  };
}

let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into languages (name, color, extensions, aliases, synced_at) values
      ('TypeScript', '#3178c6', '{.ts}', '{}', now()),
      ('Python', '#3572A5', '{.py}', '{}', now()),
      ('CSS', null, '{.css}', '{}', now())`;
  await database.sql`
    insert into package_meta (ecosystem, name, keywords, classifiers, gh_topics, derived_tags, fetched_at, expires_at) values
      ('npm', 'react', '{}', '{}', '{}', '{react,frontend}', now(), now() + interval '30 days'),
      ('pypi', 'discord-py', '{}', '{}', '{}', '{discord-bot}', now(), now() + interval '30 days'),
      ('pypi', 'react', '{}', '{}', '{}', '{wrong-ecosystem}', now(), now() + interval '30 days')`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearTools();
  clearHandlers();
});
beforeEach(async () => {
  ingestProfile.mockReset();
  await database.sql`truncate jobs, analysis_cache, metric_samples, salts, geocode_cache, users cascade`;
});

describe('loginSchema and the tool definition', () => {
  it('accepts usernames as people type them', () => {
    expect(loginSchema.parse(' @Some-One ')).toBe('Some-One');
    expect(devCardInputSchema.parse({ login: 'a' })).toEqual({ login: 'a' });
    for (const bad of ['', '-lead', 'trail-', 'has space', 'a'.repeat(40), 'semi;colon']) {
      expect(loginSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('keys the cache and the job by the lowercased login and hour', () => {
    expect(devCardTool.subjectKey({ login: 'SomeOne' })).toBe('someone');
    expect(devCardTool.idempotencyKey({ login: 'SomeOne' }, NOW, {})).toBe('analyze_profile:someone:2026-10-14T12');
    expect(devCardTool.payload?.({ login: 'x' }, {})).toEqual({ login: 'x' });
    expect(devCardTool.payload?.({ login: 'x' }, { userId: 'u1' })).toEqual({ login: 'x', requestedBy: 'u1' });
  });
});

describe('resolveTimezone', () => {
  it('falls back to UTC until the location has been geocoded', async () => {
    expect(await resolveTimezone(snapshotOf())).toEqual({ timezone: 'UTC', source: 'utc' });
    await database.sql`insert into geocode_cache (query_norm, status) values ('lahore, pakistan', 'pending')`;
    expect(await resolveTimezone(snapshotOf())).toEqual({ timezone: 'UTC', source: 'utc' });
  });

  it('uses the geocoded location of someone who has not signed up', async () => {
    await database.sql`insert into geocode_cache (query_norm, status, lat, lon, timezone)
                       values ('lahore, pakistan', 'resolved', 31.56, 74.31, 'Asia/Karachi')`;
    expect(await resolveTimezone(snapshotOf())).toEqual({ timezone: 'Asia/Karachi', source: 'location' });
  });

  it("uses a member's own timezone before their location", async () => {
    await database.sql`insert into geocode_cache (query_norm, status, lat, lon, timezone)
                       values ('lahore, pakistan', 'resolved', 31.56, 74.31, 'Asia/Karachi')`;
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, 4242, 'fixture-user-1')`;
    await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'Europe/Berlin')`;
    expect(await resolveTimezone(snapshotOf({ isMember: true }))).toEqual({ timezone: 'Europe/Berlin', source: 'profile' });

    await database.sql`update profiles set timezone = 'Not/AZone' where user_id = ${userId}`;
    expect(await resolveTimezone(snapshotOf({ isMember: true }))).toEqual({ timezone: 'Asia/Karachi', source: 'location' });
  });
});

describe('buildDevCard', () => {
  it('builds a complete, valid card from real signals', async () => {
    const card = await buildDevCard(snapshotOf());
    expect(devCardSchema.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      login: 'fixture-user-1',
      githubId: 4242,
      isMember: false,
      timezone: 'UTC',
      timezoneSource: 'utc',
      window: { eventsFrom: '2026-07-16T12:00:00.000Z', eventsTo: '2026-10-14T12:00:00.000Z' },
      enoughActivity: true,
      reposTruncated: false,
      reposAnalyzed: 3,
    });

    // Languages by bytes, colored by Linguist where it has a color.
    expect(card.languages).toEqual([
      { name: 'TypeScript', share: 52 / 88, color: '#3178c6' },
      { name: 'Python', share: 30 / 88, color: '#3572A5' },
      { name: 'CSS', share: 6 / 88, color: null },
    ]);
    // react: dependency tag + topic on the same repo = 2; discord-bot likewise. leaflet is not enriched yet.
    expect(card.tags).toEqual([
      { tag: 'discord-bot', weight: 1 },
      { tag: 'react', weight: 1 },
      { tag: 'frontend', weight: 0.5 },
      { tag: 'maps', weight: 0.5 },
    ]);

    expect(card.hourHist[18]).toBe(1);
    expect(card.hourHistUtc).toEqual(card.hourHist);
    expect(card.topics).toEqual(['discord-bot', 'maps', 'react']);
    expect(card.metrics).toMatchObject({
      nightShare: 0,
      activeDayShare: 0.5,
      longestStreak: 1,
      total365: 99,
      privateIncluded: false,
      events: 20,
      activeDays90: 45,
    });
    expect(card.calendar90).toHaveLength(90);
    expect(card.calendar90.at(-1)).toEqual({ date: '2026-10-14', count: 2 });
    // Active exactly every other day: a marathoner right at the default threshold.
    expect(card.labels).toEqual([{ key: 'marathoner', strength: 1 }]);
    expect(card.companion).toEqual({ seed: 4242, speciesKey: 'discord-bot', paletteHex: '#3178c6', stage: card.companion.stage, traits: [] });
  });

  it('reads the rhythm in the resolved timezone and follows label thresholds from settings', async () => {
    await database.sql`insert into geocode_cache (query_norm, status, lat, lon, timezone)
                       values ('lahore, pakistan', 'resolved', 31.56, 74.31, 'Asia/Karachi')`;
    const card = await buildDevCard(snapshotOf());
    expect(card.timezoneSource).toBe('location');
    expect(card.hourHist[23]).toBe(1);
    // The UTC histogram is kept alongside, for comparing two people.
    expect(card.hourHistUtc[18]).toBe(1);
    expect(card.metrics.nightShare).toBe(1);
    expect(card.labels[0]).toEqual({ key: 'nightOwl', strength: 1 / 0.35 });

    const strict = await withSettings({ 'persona.nightOwl.share': 1, 'persona.marathoner.activeDayShare': 0.9 }, () =>
      buildDevCard(snapshotOf()),
    );
    expect(strict.labels).toEqual([{ key: 'nightOwl', strength: 1 }]);
  });

  it('gives no labels below persona.minEvents, and no card without repositories either', async () => {
    const quiet = await buildDevCard(snapshotOf({ events: eveningEvents(14) }));
    expect(quiet.labels).toEqual([]);
    expect(quiet.enoughActivity).toBe(true);

    const empty = await buildDevCard(snapshotOf({ events: [], repos: [], dependencies: [] }));
    expect(empty).toMatchObject({ labels: [], enoughActivity: false, languages: [], tags: [] });
    expect(empty.hourHist.every((share) => share === 0)).toBe(true);
    expect(empty.companion).toMatchObject({ speciesKey: 'fixture-user-1', paletteHex: null });
    expect(devCardSchema.safeParse(empty).success).toBe(true);

    const lowered = await withSettings({ 'persona.minEvents': 10 }, () => buildDevCard(snapshotOf({ events: eveningEvents(14) })));
    expect(lowered.labels.length).toBeGreaterThan(0);
  });

  it('scores activity on a logarithmic scale until enough samples exist, then by percentile rank', async () => {
    const early = await withSettings({ 'companion.activityRef': 9999 }, () => buildDevCard(snapshotOf({ total: 99 })));
    expect(early.activityScore).toBeCloseTo(0.5, 12);
    expect(early.companion.stage).toBe(2);

    // 200 samples with the values 0–199: 99 has 99 below it and one equal.
    await database.sql`
      insert into metric_samples (metric_key, value, subject_hash, salt_period, recorded_on)
      select 'contrib.total365', n, 'subject-' || n, 1, current_date from generate_series(0, 199) as n`;
    const ranked = await buildDevCard(snapshotOf({ total: 99 }));
    expect(ranked.activityScore).toBeCloseTo(99.5 / 200, 12);
    expect(ranked.companion.stage).toBe(1);

    const top = await buildDevCard(snapshotOf({ total: 5000 }));
    expect(top.activityScore).toBe(1);
    expect(top.companion.stage).toBe(4);
  });

  it('notes private contributions and truncated repository lists', async () => {
    const snapshot = snapshotOf();
    snapshot.profile.contributions.restricted = 12;
    snapshot.profile.reposTruncated = true;
    const card = await buildDevCard(snapshot);
    expect(card.metrics.privateIncluded).toBe(true);
    expect(card.reposTruncated).toBe(true);
  });
});

describe('recordPersonaSamples', () => {
  it('records seven anonymous samples once per person', async () => {
    const card = await buildDevCard(snapshotOf());
    expect(await recordPersonaSamples(card, NOW)).toBe(7);
    expect(await recordPersonaSamples(card, NOW)).toBe(0);
    const rows = await database.sql`select metric_key, value, subject_hash from metric_samples order by metric_key`;
    expect(rows.map((row) => row.metric_key)).toEqual([
      'companion.activityScore',
      'contrib.total365',
      'persona.activeDayShare',
      'persona.cv',
      'persona.morningShare',
      'persona.nightShare',
      'persona.weekendShare',
    ]);
    expect(rows[0]!.value).toBe(card.activityScore);
    expect(rows[1]!.value).toBe(99);
    // The hash is salted: neither the id nor the login appears in it.
    expect(JSON.stringify(rows)).not.toContain('fixture-user-1');
    expect(new Set(rows.map((row) => row.subject_hash)).size).toBe(1);
  });

  it('records only the yearly total and activity score when there is too little activity to measure a rhythm', async () => {
    const card = await buildDevCard(snapshotOf({ events: eveningEvents(3) }));
    expect(await recordPersonaSamples(card, NOW)).toBe(2);
  });
});

describe('analyze_profile job', () => {
  beforeEach(() => {
    clearTools();
    clearHandlers();
    registerAllTools();
    registerAllHandlers();
  });

  async function run(input: unknown, options: { userId?: string } = {}) {
    const started = await startToolRun('dev-card', input, options);
    if (started.status !== 'queued') throw new Error('expected a queued run');
    const steps: string[] = [];
    await runTick({ budgetMs: 30_000, onlyJobId: started.jobId });
    const events: JobEvent[] = [];
    for await (const event of watchJob(started.jobId, { sleep: () => Promise.resolve() })) {
      events.push(event);
      if (event.event === 'progress' && event.data.progress) steps.push(event.data.progress.step);
      if (event.event === 'progress' || event.event === 'waiting') break;
    }
    return { jobId: started.jobId, last: events.at(-1), steps };
  }

  it('builds, stores and returns the card, reporting its steps', async () => {
    const reported: string[] = [];
    ingestProfile.mockImplementation(async (_login, options) => {
      for (const step of ['profile', 'events', 'manifests'] as const) {
        await options?.onStep?.(step);
        const [row] = await database.sql`select progress from jobs order by created_at desc limit 1`;
        reported.push((row!.progress as { step: string }).step);
      }
      return snapshotOf();
    });
    const { last } = await run({ login: '@Fixture-User-1' });
    expect(reported).toEqual(['repos', 'activity', 'repos']);
    expect(ingestProfile.mock.calls[0]?.[0]).toBe('Fixture-User-1');
    expect(ingestProfile.mock.calls[0]?.[1]?.identity).toEqual({ kind: 'server' });

    if (last?.event !== 'done') throw new Error(`expected done, got ${last?.event}`);
    const card = devCardSchema.parse(await loadToolResult(last.data.resultRef));
    expect(card.login).toBe('fixture-user-1');

    const [cached] = await database.sql`select kind, subject_key, is_member_subject, expires_at, computed_at from analysis_cache`;
    expect(cached).toMatchObject({ kind: 'dev_card', subject_key: 'fixture-user-1', is_member_subject: false });
    expect(cached!.expires_at.getTime() - cached!.computed_at.getTime()).toBe(12 * HOUR);
    expect(await database.sql`select 1 from metric_samples`).toHaveLength(7);

    // The next request is answered from the cache, whatever the spelling.
    expect(await startToolRun('dev-card', { login: 'FIXTURE-user-1' })).toMatchObject({ status: 'done', result: { githubId: 4242 } });
  });

  it("keeps a member's result for the full cache lifetime and a visitor's no longer than the privacy TTL", async () => {
    ingestProfile.mockResolvedValue(snapshotOf());
    await withSettings({ 'cache.devCardTtlHours': 48, 'privacy.nonUserRawTtlHours': 24 }, async () => {
      await run({ login: 'fixture-user-1' });
    });
    const [visitor] = await database.sql`select expires_at, computed_at from analysis_cache`;
    expect(visitor!.expires_at.getTime() - visitor!.computed_at.getTime()).toBe(24 * HOUR);
  });

  it("uses a member's own token only when they analyze themselves", async () => {
    ingestProfile.mockResolvedValue(snapshotOf());
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                       values (${userId}, 4242, 'Fixture-User-1', 'v1.a.b.c', 1)`;
    await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'Europe/Berlin')`;

    await run({ login: 'fixture-user-1' }, { userId });
    expect(ingestProfile.mock.calls.at(-1)?.[1]?.identity).toEqual({ kind: 'user', userId });

    await database.sql`truncate jobs, analysis_cache cascade`;
    await run({ login: 'someone-else' }, { userId });
    expect(ingestProfile.mock.calls.at(-1)?.[1]?.identity).toEqual({ kind: 'server' });

    await database.sql`truncate jobs, analysis_cache cascade`;
    await database.sql`update github_identities set token_invalid = true where user_id = ${userId}`;
    await run({ login: 'fixture-user-1' }, { userId });
    expect(ingestProfile.mock.calls.at(-1)?.[1]?.identity).toEqual({ kind: 'server' });
  });

  it('continues while manifests are unread, then builds the card anyway', async () => {
    ingestProfile.mockResolvedValue(snapshotOf({ manifestsComplete: false }));
    const { jobId } = await run({ login: 'fixture-user-1' });
    for (let pass = 0; pass < 3; pass += 1) await runTick({ budgetMs: 30_000 });
    // A full tick also runs whatever the schedules enqueue; only this chain matters here.
    const chain = await database.sql`select status, payload from jobs where type = 'analyze_profile' order by created_at`;
    expect(chain.map((job) => (job.payload as { pass?: number }).pass ?? 0)).toEqual([0, 1, 2, 3]);
    expect(chain.every((job) => job.status === 'done')).toBe(true);

    const events: JobEvent[] = [];
    for await (const event of watchJob(jobId, { sleep: () => Promise.resolve() })) events.push(event);
    expect(events.at(-1)?.event).toBe('done');
    expect(await database.sql`select 1 from analysis_cache`).toHaveLength(1);
  });

  it('explains organizations and unknown accounts kindly and does not retry them', async () => {
    ingestProfile.mockRejectedValueOnce(new GitHubOrganizationError());
    const organization = await run({ login: 'some-org' });
    expect(organization.last).toEqual({ event: 'error', data: { message: "That's an organization. Dev Cards are for people." } });

    ingestProfile.mockRejectedValueOnce(new GitHubNotFoundError('@ghost'));
    const missing = await run({ login: 'ghost' });
    expect(missing.last).toEqual({ event: 'error', data: { message: "We couldn't find @ghost on GitHub. Check the spelling?" } });

    const jobs = await database.sql`select status, attempts from jobs`;
    expect(jobs.every((job) => job.status === 'failed' && job.attempts === 1)).toBe(true);
    expect(await database.sql`select 1 from analysis_cache`).toHaveLength(0);
  });

  it('rejects an invalid login before anything is queued', async () => {
    await expect(startToolRun('dev-card', { login: 'not a login' })).rejects.toMatchObject({
      field: 'login',
      userMessage: 'That does not look like a GitHub username.',
    });
    expect(await database.sql`select 1 from jobs`).toHaveLength(0);
  });
});
