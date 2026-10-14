import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { ExternalServiceError, RateLimitError, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { githubRepoFromGoModule, githubRepoFromUrl, registryClientFor } from './clients';
import { enrichPackage, findStalePackages } from './enrich';
import { withRegistryPace } from './pacer';
import { classifierLeaf, deriveTags, loadAliasMap, normalizeTag } from './tags';

// Real registry responses, trimmed to the fields we read (recorded 2026-10-14).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../__fixtures__/registries/${name}.json`, import.meta.url), 'utf8'));

const NOW = new Date('2026-10-14T12:00:00.000Z');
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;

const rate = () => ({
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4990',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-resource': 'core',
});

/** Serves GitHub repository lookups: `topicsByRepo` maps `owner/repo` to its topics. */
function serveGitHub(topicsByRepo: Record<string, string[]>) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 } } }),
    ),
    http.get(`${API}/repos/:owner/:repo`, ({ params }) => {
      const topics = topicsByRepo[`${String(params.owner)}/${String(params.repo)}`];
      return topics === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: rate() })
        : HttpResponse.json({ full_name: `${String(params.owner)}/${String(params.repo)}`, topics }, { headers: rate() });
    }),
  );
}

const enrich = (ecosystem: Parameters<typeof enrichPackage>[0], name: string, sleep = vi.fn(() => Promise.resolve())) =>
  enrichPackage(ecosystem, name, { now: () => NOW, sleep });

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`insert into topics (slug, display_name, aliases, related, blob_sha, synced_at) values
    ('react', 'React', '{reactjs,react-js}', '{}', 'a', now()),
    ('machine-learning', 'Machine learning', '{ml}', '{}', 'b', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  await database.sql`truncate package_meta, registry_pacing, api_cache, github_budgets`;
});

describe('tag normalization', () => {
  it('lowercases and hyphenates', () => {
    expect(normalizeTag('Image Recognition')).toBe('image-recognition');
    expect(normalizeTag('no_std')).toBe('no-std');
    expect(normalizeTag('Scientific/Engineering')).toBe('scientific-engineering');
    expect(normalizeTag('  PSR-3 ')).toBe('psr-3');
    expect(normalizeTag('C++')).toBe('c++');
    expect(normalizeTag('c#')).toBe('c#');
    expect(normalizeTag('node.js')).toBe('node-js');
  });

  it('drops empty and absurd values', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag(' -- ')).toBeNull();
    expect(normalizeTag('💥')).toBeNull();
    expect(normalizeTag('x'.repeat(60))).toBeNull();
  });

  it('takes the leaf of Topic classifiers only', () => {
    expect(classifierLeaf('Topic :: Scientific/Engineering :: Image Recognition')).toBe('Image Recognition');
    expect(classifierLeaf('Topic :: Software Development :: Libraries')).toBe('Libraries');
    expect(classifierLeaf('Programming Language :: Python :: 3')).toBeNull();
    expect(classifierLeaf('Development Status :: 4 - Beta')).toBeNull();
  });

  it('derives the sorted union and maps aliases to their topic', async () => {
    const aliases = await loadAliasMap(database.db);
    expect(aliases.get('reactjs')).toBe('react');
    expect(aliases.get('react')).toBe('react');
    const tags = deriveTags(
      {
        keywords: ['ReactJS', 'ui', 'ML'],
        classifiers: ['Topic :: Scientific/Engineering :: Image Recognition', 'Programming Language :: Python'],
        categories: ['no-std::no-alloc', 'encoding'],
        ghTopics: ['react', 'declarative'],
      },
      aliases,
    );
    expect(tags).toEqual(['declarative', 'encoding', 'image-recognition', 'machine-learning', 'no-alloc', 'react', 'ui']);
  });
});

describe('repository URLs', () => {
  it('finds owner/repo in the forms registries use', () => {
    expect(githubRepoFromUrl('git+https://github.com/facebook/react.git')).toBe('facebook/react');
    expect(githubRepoFromUrl('git://github.com/expressjs/express.git')).toBe('expressjs/express');
    expect(githubRepoFromUrl('git@github.com:Seldaek/monolog.git')).toBe('Seldaek/monolog');
    expect(githubRepoFromUrl('https://github.com/serde-rs/serde')).toBe('serde-rs/serde');
    expect(githubRepoFromUrl('https://github.com/scikit-image/scikit-image/issues')).toBe('scikit-image/scikit-image');
  });

  it('returns null for anything else', () => {
    for (const url of [null, undefined, '', 'https://gitlab.com/a/b', 'https://example.com', 'not a url']) {
      expect(githubRepoFromUrl(url)).toBeNull();
    }
  });

  it('reads Go module paths', () => {
    expect(githubRepoFromGoModule('github.com/go-playground/validator/v10')).toBe('go-playground/validator');
    expect(githubRepoFromGoModule('golang.org/x/net')).toBeNull();
  });
});

describe('registry clients', () => {
  it('builds the documented endpoints', () => {
    expect(registryClientFor('npm')?.url('@scope/pkg')).toBe('https://registry.npmjs.org/@scope%2Fpkg/latest');
    expect(registryClientFor('pypi')?.url('scikit-image')).toBe('https://pypi.org/pypi/scikit-image/json');
    expect(registryClientFor('crates')?.url('serde')).toBe('https://crates.io/api/v1/crates/serde');
    expect(registryClientFor('pub')?.url('provider')).toBe('https://pub.dev/api/packages/provider');
    expect(registryClientFor('packagist')?.url('monolog/monolog')).toBe('https://repo.packagist.org/p2/monolog/monolog.json');
    for (const ecosystem of ['go', 'maven', 'rubygems'] as const) expect(registryClientFor(ecosystem)).toBeNull();
  });

  it('parses each real response', () => {
    expect(registryClientFor('npm')?.parse(fixture('npm-react'), 'react')).toEqual({
      keywords: ['react'],
      classifiers: [],
      categories: [],
      repoFullName: 'react/react',
    });
    const pypi = registryClientFor('pypi')?.parse(fixture('pypi-scikit-image'), 'scikit-image');
    expect(pypi?.repoFullName).toBe('scikit-image/scikit-image');
    expect(pypi?.classifiers).toContain('Topic :: Scientific/Engineering');
    expect(registryClientFor('crates')?.parse(fixture('crates-serde'), 'serde')).toEqual({
      keywords: ['serialization', 'no_std', 'serde'],
      classifiers: [],
      categories: ['no-std', 'encoding', 'no-std::no-alloc'],
      repoFullName: 'serde-rs/serde',
    });
    expect(registryClientFor('pub')?.parse(fixture('pub-provider'), 'provider').repoFullName).toBe('rrousselGit/provider');
    expect(registryClientFor('packagist')?.parse(fixture('packagist-monolog'), 'monolog/monolog')).toEqual({
      keywords: ['log', 'logging', 'psr-3'],
      classifiers: [],
      categories: [],
      repoFullName: 'Seldaek/monolog',
    });
  });

  it('accepts comma-separated keyword strings and rejects the wrong shape', () => {
    const pypi = registryClientFor('pypi');
    expect(pypi?.parse({ info: { keywords: 'image, vision processing' } }, 'x').keywords).toEqual(['image', 'vision', 'processing']);
    expect(() => pypi?.parse({ nope: true }, 'x')).toThrow();
  });
});

describe('enrichPackage', () => {
  it('stores registry metadata, GitHub topics and derived tags for each registry', async () => {
    const seen: Record<string, string | null> = {};
    const record = (key: string) => ({ request }: { request: Request }) => {
      seen[key] = request.headers.get('user-agent');
    };
    serveGitHub({
      'react/react': ['reactjs', 'ui', 'declarative'],
      'scikit-image/scikit-image': ['image-processing', 'computer-vision'],
      'serde-rs/serde': ['serde', 'no-std'],
      'Seldaek/monolog': ['logging', 'php'],
    });
    server.use(
      http.get('https://registry.npmjs.org/react/latest', (info) => (record('npm')(info), HttpResponse.json(fixture('npm-react') as object))),
      http.get('https://pypi.org/pypi/scikit-image/json', () => HttpResponse.json(fixture('pypi-scikit-image') as object)),
      http.get('https://crates.io/api/v1/crates/serde', (info) => (record('crates')(info), HttpResponse.json(fixture('crates-serde') as object))),
      http.get('https://pub.dev/api/packages/provider', () => HttpResponse.json(fixture('pub-provider') as object)),
      http.get('https://repo.packagist.org/p2/monolog/monolog.json', () => HttpResponse.json(fixture('packagist-monolog') as object)),
    );

    expect(await enrich('npm', 'react')).toEqual({ status: 'enriched', derivedTags: ['declarative', 'react', 'ui'] });
    expect((await enrich('pypi', 'scikit-image')).derivedTags).toEqual([
      'computer-vision',
      'image-processing',
      'libraries',
      'scientific-engineering',
    ]);
    expect((await enrich('crates', 'serde')).derivedTags).toEqual(['encoding', 'no-alloc', 'no-std', 'serde', 'serialization']);
    // The repository of this package is not served: a missing repo just means no topics.
    expect(await enrich('pub', 'provider')).toEqual({ status: 'enriched', derivedTags: [] });
    expect((await enrich('packagist', 'monolog/monolog')).derivedTags).toEqual(['log', 'logging', 'php', 'psr-3']);

    // Registries require an identifying User-Agent (CLAUDE.md §2.5).
    expect(seen.npm).toBe('CommitMates/1.0 (dev@example.com)');
    expect(seen.crates).toBe('CommitMates/1.0 (dev@example.com)');

    const [row] = await database.sql`select * from package_meta where ecosystem = 'npm' and name = 'react'`;
    expect(row).toMatchObject({
      keywords: ['react'],
      repo_full_name: 'react/react',
      gh_topics: ['reactjs', 'ui', 'declarative'],
      derived_tags: ['declarative', 'react', 'ui'],
    });
    expect(row!.expires_at.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
  });

  it('uses GitHub topics alone for ecosystems without a registry call', async () => {
    serveGitHub({ 'gin-gonic/gin': ['go', 'framework', 'gin'] });
    expect(await enrich('go', 'github.com/gin-gonic/gin')).toEqual({ status: 'enriched', derivedTags: ['framework', 'gin', 'go'] });
    expect(await enrich('go', 'golang.org/x/net')).toEqual({ status: 'enriched', derivedTags: [] });
    expect(await enrich('maven', 'org.springframework.boot:spring-boot-starter-web')).toEqual({ status: 'enriched', derivedTags: [] });
    expect(await database.sql`select 1 from registry_pacing`).toHaveLength(0);
  });

  it('does not fetch a package that is still fresh', async () => {
    let calls = 0;
    serveGitHub({});
    server.use(
      http.get('https://crates.io/api/v1/crates/serde', () => {
        calls += 1;
        return HttpResponse.json({ crate: { keywords: ['serialization'], categories: [], repository: null } });
      }),
    );
    expect((await enrich('crates', 'serde')).status).toBe('enriched');
    expect(await enrich('crates', 'serde')).toEqual({ status: 'fresh', derivedTags: ['serialization'] });
    expect(calls).toBe(1);

    // Once expired it is fetched again.
    await database.sql`update package_meta set expires_at = ${new Date(NOW.getTime() - 1000)}`;
    expect((await enrich('crates', 'serde')).status).toBe('enriched');
    expect(calls).toBe(2);
  });

  it('remembers a package the registry does not know', async () => {
    let calls = 0;
    server.use(
      http.get('https://registry.npmjs.org/left-pad-typo/latest', () => {
        calls += 1;
        return HttpResponse.json({ error: 'Not found' }, { status: 404 });
      }),
    );
    expect(await enrich('npm', 'left-pad-typo')).toEqual({ status: 'not_found', derivedTags: [] });
    expect((await enrich('npm', 'left-pad-typo')).status).toBe('fresh');
    expect(calls).toBe(1);
  });

  it('fails retryably on registry errors and unexpected bodies, storing nothing', async () => {
    server.use(
      http.get('https://pypi.org/pypi/down/json', () => HttpResponse.json({}, { status: 503 })),
      http.get('https://pypi.org/pypi/odd/json', () => HttpResponse.json({ unexpected: true })),
      http.get('https://pypi.org/pypi/offline/json', () => HttpResponse.error()),
    );
    for (const name of ['down', 'odd', 'offline']) {
      await expect(enrich('pypi', name)).rejects.toBeInstanceOf(ExternalServiceError);
    }
    expect(await database.sql`select 1 from package_meta`).toHaveLength(0);
  });
});

describe('registry pacing', () => {
  it('spaces calls to one registry by sources.registry.minIntervalMs', async () => {
    let clock = NOW.getTime();
    const waits: number[] = [];
    const options = {
      now: () => new Date(clock),
      sleep: (ms: number) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      maxWaitMs: 10_000,
    };
    const callTimes: number[] = [];
    const call = () => {
      callTimes.push(clock);
      return Promise.resolve('ok');
    };

    await withRegistryPace('npm', options, call);
    await withRegistryPace('npm', options, call);
    clock += 400;
    await withRegistryPace('npm', options, call);
    clock += 5000;
    await withRegistryPace('npm', options, call);

    expect(waits).toEqual([1000, 600]);
    expect(callTimes[1]! - callTimes[0]!).toBe(1000);
    expect(callTimes[2]! - callTimes[1]!).toBe(1000);
    expect(callTimes[3]! - callTimes[2]!).toBeGreaterThanOrEqual(1000);
  });

  it('paces registries independently', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const options = { now: () => NOW, sleep, maxWaitMs: 10_000 };
    await withRegistryPace('npm', options, () => Promise.resolve(1));
    await withRegistryPace('pypi', options, () => Promise.resolve(1));
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps one request in flight per registry under concurrent callers', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const call = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
    };
    const options = { now: () => new Date(), sleep: () => Promise.resolve(), maxWaitMs: 10_000 };
    await withSettings({ 'sources.registry.minIntervalMs': 0 }, () =>
      Promise.all(Array.from({ length: 6 }, () => withRegistryPace('crates', options, call))),
    );
    expect(maxInFlight).toBe(1);
  });

  it('hands a long wait back to the job and still counts a failed call', async () => {
    const options = { now: () => NOW, sleep: vi.fn(() => Promise.resolve()), maxWaitMs: 100 };
    await expect(withRegistryPace('pub', options, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    const error = await withRegistryPace('pub', options, () => Promise.resolve(1)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetAt.getTime()).toBe(NOW.getTime() + 1000);
    expect(options.sleep).not.toHaveBeenCalled();
  });
});

describe('findStalePackages', () => {
  it('returns unknown and expired packages once each', async () => {
    await database.sql`insert into package_meta (ecosystem, name, keywords, classifiers, gh_topics, derived_tags, fetched_at, expires_at) values
      ('npm', 'fresh', '{}', '{}', '{}', '{}', ${NOW}, ${new Date(NOW.getTime() + 86_400_000)}),
      ('npm', 'expired', '{}', '{}', '{}', '{}', ${NOW}, ${new Date(NOW.getTime() - 1000)}),
      ('pypi', 'fresh', '{}', '{}', '{}', '{}', ${NOW}, ${new Date(NOW.getTime() - 1000)})`;
    const stale = await findStalePackages(
      [
        { ecosystem: 'npm', name: 'fresh' },
        { ecosystem: 'npm', name: 'expired' },
        { ecosystem: 'npm', name: 'unknown' },
        { ecosystem: 'npm', name: 'unknown' },
        { ecosystem: 'pypi', name: 'fresh' },
      ],
      NOW,
    );
    expect(stale).toEqual([
      { ecosystem: 'npm', name: 'expired' },
      { ecosystem: 'npm', name: 'unknown' },
      { ecosystem: 'pypi', name: 'fresh' },
    ]);
    expect(await findStalePackages([], NOW)).toEqual([]);
  });
});
