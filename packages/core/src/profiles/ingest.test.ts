import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { purgeNonMemberRaw, recordMetricSamples, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { GitHubNotFoundError, GitHubOrganizationError, resetGitHubClientState } from '@commitmates/github';
import { enqueue, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { ingestProfile } from './ingest';

const read = (name: string) => readFileSync(new URL(`../__fixtures__/profile/${name}`, import.meta.url), 'utf8');
const json = (name: string): unknown => JSON.parse(read(name));

const API = 'https://api.github.com';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const HOUR = 3_600_000;
const server = createMswServer();
let database: TestDatabase;
let fileRequests: string[] = [];

const rate = () => ({
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4990',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-resource': 'core',
});

function serve(overrides: { graphql?: unknown; packageJsonSha?: string } = {}) {
  const campusContents = (json('contents-campus-map.json') as { name: string; sha: string }[]).map((entry) =>
    entry.name === 'package.json' && overrides.packageJsonSha ? { ...entry, sha: overrides.packageJsonSha } : entry,
  );
  const file = (name: string) => () => {
    fileRequests.push(name);
    return new HttpResponse(read(name === 'package.json' ? 'package.json.txt' : name), {
      headers: { ...rate(), 'content-type': 'text/plain; charset=utf-8' },
    });
  };
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({
        resources: {
          core: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 },
          graphql: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 },
        },
      }),
    ),
    http.post(`${API}/graphql`, async ({ request }) => {
      const body = (await request.json()) as { variables: { login: string; repoCount: number; from: string; to: string } };
      expect(body.variables.repoCount).toBeLessThanOrEqual(100);
      expect(new Date(body.variables.to).getTime() - new Date(body.variables.from).getTime()).toBe(365 * 24 * HOUR);
      return HttpResponse.json((overrides.graphql ?? json('graphql-user.json')) as object);
    }),
    http.get(`${API}/users/fixture-user-1/events/public`, () => HttpResponse.json(json('events.json') as object, { headers: rate() })),
    http.get(`${API}/repos/fixture-user-1/campus-map/contents`, () => HttpResponse.json(campusContents, { headers: rate() })),
    http.get(`${API}/repos/fixture-user-1/grade-bot/contents`, () =>
      HttpResponse.json(json('contents-grade-bot.json') as object, { headers: rate() }),
    ),
    // An empty repository has no contents.
    http.get(`${API}/repos/fixture-user-1/notes/contents`, () =>
      HttpResponse.json({ message: 'This repository is empty.' }, { status: 404, headers: rate() }),
    ),
    http.get(`${API}/repos/fixture-user-1/campus-map/contents/package.json`, file('package.json')),
    http.get(`${API}/repos/fixture-user-1/grade-bot/contents/requirements.txt`, file('requirements.txt')),
    http.get(`${API}/repos/fixture-user-1/grade-bot/contents/requirements-dev.txt`, file('requirements-dev.txt')),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  fileRequests = [];
  await database.sql`truncate gh_users, gh_repos, repo_manifests, repo_dependencies, analysis_cache, api_cache,
                              github_budgets, jobs, package_meta, metric_samples, salts cascade`;
});

describe('ingestProfile', () => {
  it('ingests a profile completely: user, repositories, events, manifests and dependencies', async () => {
    serve();
    const snapshot = await ingestProfile('fixture-user-1', { now: NOW });

    expect(snapshot.isMember).toBe(false);
    expect(snapshot.manifestsComplete).toBe(true);
    expect(snapshot.profile).toMatchObject({
      githubId: 4242,
      login: 'fixture-user-1',
      location: 'Lahore, Pakistan',
      blog: null,
      publicRepos: 3,
      pinnedRepoIds: [9000, 9001],
      reposTruncated: false,
    });
    expect(snapshot.profile.contributions.days).toHaveLength(28);
    expect(snapshot.profile.contributions.total).toBe(43);
    expect(snapshot.profile.repos.map((repo) => [repo.name, repo.licenseSpdx])).toEqual([
      ['campus-map', 'MIT'],
      ['grade-bot', null],
      ['notes', null],
    ]);

    // Only the kinds F1 uses are kept; a star is not activity.
    expect(snapshot.events.map((event) => event.kind)).toEqual(['push', 'pull_request', 'push', 'issue', 'create', 'review']);
    expect(snapshot.events[0]).toMatchObject({ commits: 2, repo: 'fixture-user-1/campus-map' });
    expect(snapshot.events[0]!.messages).toEqual(['Add building search with fuzzy matching', 'fix']);

    const [user] = await database.sql`select * from gh_users where github_id = 4242`;
    expect(user).toMatchObject({ login: 'fixture-user-1', type: 'User', is_member: false, followers: 12, public_repos: 3 });
    expect(user!.expires_at.getTime()).toBe(NOW.getTime() + 24 * HOUR);
    // The location is queued for the paced geocoder, never looked up inline.
    expect(user!.geocode_key).toBe('lahore, pakistan');
    expect(await database.sql`select query_norm, status from geocode_cache`).toEqual([
      { query_norm: 'lahore, pakistan', status: 'pending' },
    ]);

    const repos = await database.sql`select full_name, stars, topics, languages, license_spdx, expires_at, homepage
                                     from gh_repos order by github_id`;
    expect(repos.map((repo) => repo.full_name)).toEqual([
      'fixture-user-1/campus-map',
      'fixture-user-1/grade-bot',
      'fixture-user-1/notes',
    ]);
    expect(repos[0]).toMatchObject({
      stars: 14,
      topics: ['react', 'maps'],
      languages: { TypeScript: 52000, CSS: 6000 },
      homepage: 'https://campus-map.example.org',
    });
    expect(repos.every((repo) => repo.expires_at.getTime() === NOW.getTime() + 24 * HOUR)).toBe(true);

    const manifests = await database.sql`select path, ecosystem, blob_sha from repo_manifests order by path`;
    expect(manifests).toEqual([
      { path: 'package.json', ecosystem: 'npm', blob_sha: 'pkg-v1' },
      { path: 'requirements-dev.txt', ecosystem: 'pypi', blob_sha: 'reqdev-v1' },
      { path: 'requirements.txt', ecosystem: 'pypi', blob_sha: 'req-v1' },
    ]);
    const dependencies = await database.sql`select ecosystem, package_name, is_dev from repo_dependencies order by ecosystem, package_name`;
    expect(dependencies).toEqual([
      { ecosystem: 'npm', package_name: 'leaflet', is_dev: false },
      { ecosystem: 'npm', package_name: 'react', is_dev: false },
      { ecosystem: 'npm', package_name: 'typescript', is_dev: true },
      { ecosystem: 'npm', package_name: 'vitest', is_dev: true },
      { ecosystem: 'pypi', package_name: 'discord-py', is_dev: false },
      { ecosystem: 'pypi', package_name: 'pytest', is_dev: true },
      { ecosystem: 'pypi', package_name: 'requests', is_dev: false },
    ]);
    expect(snapshot.dependencies).toHaveLength(7);

    // Unknown packages are queued for enrichment, once each.
    const queued = await database.sql`select payload from jobs where type = 'enrich_packages'`;
    expect(queued).toHaveLength(7);
  });

  it('finds repositories through full-text search on the generated column', async () => {
    serve();
    await ingestProfile('fixture-user-1', { now: NOW });
    const rows = await database.sql`
      select full_name from gh_repos where search_tsv @@ websearch_to_tsquery('simple', 'maps')`;
    expect(rows).toEqual([{ full_name: 'fixture-user-1/campus-map' }]);
  });

  it('does not fetch manifest files again while their blob sha is unchanged', async () => {
    serve();
    await ingestProfile('fixture-user-1', { now: NOW });
    expect(fileRequests.sort()).toEqual(['package.json', 'requirements-dev.txt', 'requirements.txt']);

    fileRequests = [];
    await database.sql`delete from api_cache`;
    serve({ packageJsonSha: 'pkg-v2' });
    await ingestProfile('fixture-user-1', { now: new Date(NOW.getTime() + HOUR) });
    expect(fileRequests).toEqual(['package.json']);
    const [manifest] = await database.sql`select blob_sha from repo_manifests where path = 'package.json'`;
    expect(manifest!.blob_sha).toBe('pkg-v2');
  });

  it('keeps a member forever: no expiry on their rows', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, 4242, 'fixture-user-1')`;
    serve();
    const snapshot = await ingestProfile('fixture-user-1', { now: NOW });
    expect(snapshot.isMember).toBe(true);
    const [user] = await database.sql`select is_member, expires_at from gh_users where github_id = 4242`;
    expect(user).toEqual({ is_member: true, expires_at: null });
    const repos = await database.sql`select expires_at from gh_repos`;
    expect(repos.every((repo) => repo.expires_at === null)).toBe(true);
    await database.sql`delete from auth.users where id = ${userId}`;
  });

  it('reads only as many manifests as persona.manifestRepos allows, most recently pushed first', async () => {
    serve();
    await withSettings({ 'persona.manifestRepos': 1 }, () => ingestProfile('fixture-user-1', { now: NOW }));
    const manifests = await database.sql`select path from repo_manifests`;
    expect(manifests).toEqual([{ path: 'package.json' }]);
  });

  it('stops reading manifests at the deadline and says so', async () => {
    serve();
    const snapshot = await ingestProfile('fixture-user-1', { now: NOW, deadline: Date.now() + 1000 });
    expect(snapshot.manifestsComplete).toBe(false);
    expect(fileRequests).toEqual([]);
    // The profile itself is stored either way.
    expect(await database.sql`select 1 from gh_users`).toHaveLength(1);
  });

  it('rejects organizations and unknown logins without storing anything', async () => {
    serve({ graphql: json('graphql-organization.json') });
    await expect(ingestProfile('some-org', { now: NOW })).rejects.toBeInstanceOf(GitHubOrganizationError);

    serve({ graphql: { data: { repositoryOwner: null, rateLimit: { limit: 5000, cost: 1, remaining: 4900, resetAt: '2026-10-14T13:00:00Z' } } } });
    const error = await ingestProfile('nobody-here', { now: NOW }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubNotFoundError);
    expect((error as GitHubNotFoundError).userMessage).toBe("We couldn't find @nobody-here on GitHub. Check the spelling?");
    expect(await database.sql`select 1 from gh_users`).toHaveLength(0);
  });
});

describe('purge of non-member data', () => {
  it('removes a non-member profile after the TTL and leaves members alone', async () => {
    serve();
    await ingestProfile('fixture-user-1', { now: NOW });
    await database.sql`insert into gh_users (github_id, login, is_member, fetched_at, expires_at)
                       values (777, 'member-account', true, ${NOW}, null)`;
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, fetched_at, expires_at)
                       values (7770, 777, 'member-account/thing', 'thing', ${NOW}, null)`;
    await database.sql`insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at) values
      ('dev_card', 'fixture-user-1', 'h', '{}', false, ${NOW}, ${new Date(NOW.getTime() + 12 * HOUR)}),
      ('dev_card', 'member-account', 'h', '{}', true, ${NOW}, ${new Date(NOW.getTime() + 48 * HOUR)})`;

    // Before the TTL nothing is removed.
    // Before the TTL the profile stays; the tool result had its own, shorter lifetime.
    expect(await purgeNonMemberRaw(new Date(NOW.getTime() + 23 * HOUR))).toMatchObject({ users: 0, repos: 0, analyses: 1 });

    const report = await purgeNonMemberRaw(new Date(NOW.getTime() + 25 * HOUR));
    expect(report).toMatchObject({ users: 1, repos: 3, analyses: 0 });
    expect(report.apiResponses).toBeGreaterThan(0);

    expect((await database.sql`select login from gh_users`).map((row) => row.login)).toEqual(['member-account']);
    expect((await database.sql`select full_name from gh_repos`).map((row) => row.full_name)).toEqual(['member-account/thing']);
    // Manifests and dependencies go with their repository.
    expect(await database.sql`select 1 from repo_manifests`).toHaveLength(0);
    expect(await database.sql`select 1 from repo_dependencies`).toHaveLength(0);
    expect((await database.sql`select subject_key from analysis_cache`).map((row) => row.subject_key)).toEqual(['member-account']);
    expect(await database.sql`select 1 from api_cache`).toHaveLength(0);
  });

  it('keeps country-index rows and runs as an hourly job', async () => {
    await database.sql`insert into gh_users (github_id, login, in_country_index, fetched_at, expires_at)
                       values (888, 'indexed', true, ${NOW}, ${new Date(Date.now() - HOUR)})`;
    const job = await enqueue('purge_non_user_raw', {});
    const report = await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    expect(report.done).toBe(1);
    expect(await database.sql`select 1 from gh_users where github_id = 888`).toHaveLength(1);
    const [schedule] = await database.sql`select cron_expr from job_schedules where name = 'purge-non-user-raw'`;
    expect(schedule).toEqual({ cron_expr: '10 * * * *' });
  });
});

describe('recordMetricSamples', () => {
  it('counts one person once per metric and salt period', async () => {
    expect(await recordMetricSamples(4242, { 'persona.nightShare': 0.4, 'contrib.total365': 310 }, NOW)).toBe(2);
    // The same person analyzed again adds nothing; a new metric still counts.
    expect(await recordMetricSamples(4242, { 'persona.nightShare': 0.9, 'persona.cv': 1.2 }, NOW)).toBe(1);
    expect(await recordMetricSamples(4243, { 'persona.nightShare': 0.1 }, NOW)).toBe(1);

    const rows = await database.sql`select metric_key, value, subject_hash from metric_samples order by metric_key, value`;
    expect(rows.map((row) => [row.metric_key, row.value])).toEqual([
      ['contrib.total365', 310],
      ['persona.cv', 1.2],
      ['persona.nightShare', 0.1],
      ['persona.nightShare', 0.4],
    ]);
    // The stored hash is salted: it is not the plain hash of the id, which anyone could recompute.
    const unsalted = createHash('sha256').update('4242').digest('hex');
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.subject_hash) && row.subject_hash !== unsalted)).toBe(true);
  });

  it('counts the same person again in the next salt period and ignores non-finite values', async () => {
    await recordMetricSamples(4242, { 'persona.cv': 1 }, NOW);
    const later = new Date(NOW.getTime() + 31 * 24 * HOUR);
    expect(await recordMetricSamples(4242, { 'persona.cv': 2, 'persona.bad': Number.NaN }, later)).toBe(1);
    expect(await recordMetricSamples(4242, {}, later)).toBe(0);
  });
});
