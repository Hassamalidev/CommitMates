import { ExternalServiceError, getDb, getLogger, getSetting, schema, type Db } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import { GitHubNotFoundError, SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { Ecosystem } from '../manifests/parsers';

import { githubRepoFromGoModule, registryClientFor, type RegistryMeta } from './clients';
import { withRegistryPace } from './pacer';
import { deriveTags, loadAliasMap } from './tags';

const { packageMeta } = schema;

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** HTTP statuses the registries use that we branch on (protocol constants). */
const NOT_FOUND = 404;
const TOO_MANY_REQUESTS = 429;

export type EnrichOptions = {
  db?: Db;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Epoch ms the caller must finish by; bounds the pacing wait. */
  deadline?: number;
};

export type EnrichResult = { status: 'fresh' | 'enriched' | 'not_found'; derivedTags: string[] };

const EMPTY_META: RegistryMeta = { keywords: [], classifiers: [], categories: [], repoFullName: null };
/** Longest pacing pause taken inline when the caller gives no deadline. */
const DEFAULT_MAX_WAIT_MS = 5000;

async function fetchRegistryMeta(
  ecosystem: Ecosystem,
  name: string,
  options: Required<Pick<EnrichOptions, 'now' | 'sleep'>> & { db: Db; deadline: number | undefined },
): Promise<RegistryMeta | null> {
  const client = registryClientFor(ecosystem);
  if (!client) return EMPTY_META;

  const [userAgent, timeoutMs] = await Promise.all([
    getSetting('sources.userAgent', options.db),
    getSetting('sources.requestTimeoutMs', options.db),
  ]);
  const maxWaitMs = options.deadline === undefined ? DEFAULT_MAX_WAIT_MS : Math.max(0, options.deadline - Date.now());

  return withRegistryPace(
    client.registry,
    { now: options.now, sleep: options.sleep, maxWaitMs },
    async () => {
      let response: Response;
      try {
        response = await fetch(client.url(name), {
          headers: { 'User-Agent': `${userAgent} (${serverEnv.CONTACT_EMAIL})`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ExternalServiceError('registry.unreachable', 'A package registry is unreachable right now.', { cause: error });
      }
      if (response.status === NOT_FOUND) return null;
      if (!response.ok) {
        const retryable = response.status === TOO_MANY_REQUESTS || response.status >= 500; // allowed-literal: first HTTP server-error status
        getLogger().warn({ registry: client.registry, status: response.status, retryable }, 'registry request failed');
        throw new ExternalServiceError('registry.error', 'A package registry answered with an error.');
      }
      try {
        return client.parse(await response.json(), name);
      } catch (error) {
        throw new ExternalServiceError('registry.unexpected_response', 'A package registry answered in an unexpected format.', {
          cause: error,
        });
      }
    },
    options.db,
  );
}

const repoTopicsSchema = z.object({ topics: z.array(z.string()).nullish() });

/** Topics of a package's GitHub repository: the fallback every ecosystem has (CLAUDE.md §6.6). */
async function fetchRepoTopics(repoFullName: string, db: Db, now: () => Date): Promise<string[]> {
  const [owner, repo] = repoFullName.split('/');
  if (!owner || !repo) return [];
  try {
    const data = await githubFor(SERVER_IDENTITY, { db, now }).get(
      'GET /repos/{owner}/{repo}',
      { owner, repo },
      repoTopicsSchema,
      { what: repoFullName },
    );
    return data.topics ?? [];
  } catch (error) {
    // Registry metadata often points at repositories that have moved or gone private.
    if (error instanceof GitHubNotFoundError) return [];
    throw error;
  }
}

/**
 * Fetches a package's registry metadata and GitHub topics, derives its tags, and stores
 * them in `package_meta` for `cache.packageMetaTtlDays`. A package that is still fresh is
 * not fetched again. A package the registry does not know is stored empty, so it is not
 * asked for on every run.
 */
export async function enrichPackage(ecosystem: Ecosystem, name: string, options: EnrichOptions = {}): Promise<EnrichResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const [fresh] = await db
    .select({ derivedTags: packageMeta.derivedTags })
    .from(packageMeta)
    .where(and(eq(packageMeta.ecosystem, ecosystem), eq(packageMeta.name, name), gt(packageMeta.expiresAt, now())));
  if (fresh) return { status: 'fresh', derivedTags: fresh.derivedTags };

  const registry = await fetchRegistryMeta(ecosystem, name, { db, now, sleep, deadline: options.deadline });
  const meta = registry ?? EMPTY_META;
  const repoFullName = meta.repoFullName ?? (ecosystem === 'go' ? githubRepoFromGoModule(name) : null);
  const ghTopics = repoFullName ? await fetchRepoTopics(repoFullName, db, now) : [];
  const derivedTags = deriveTags(
    { keywords: meta.keywords, classifiers: meta.classifiers, categories: meta.categories, ghTopics },
    await loadAliasMap(db),
  );

  const ttlDays = await getSetting('cache.packageMetaTtlDays', db);
  const values = {
    keywords: meta.keywords,
    classifiers: meta.classifiers,
    repoFullName,
    ghTopics,
    derivedTags,
    fetchedAt: now(),
    expiresAt: new Date(now().getTime() + ttlDays * MS_PER_DAY),
  };
  await db
    .insert(packageMeta)
    .values({ ecosystem, name, ...values })
    .onConflictDoUpdate({ target: [packageMeta.ecosystem, packageMeta.name], set: values });

  return { status: registry === null ? 'not_found' : 'enriched', derivedTags };
}

export type PackageRef = { ecosystem: Ecosystem; name: string };

/** Of the given packages, the ones with no fresh `package_meta` row. */
export async function findStalePackages(packages: readonly PackageRef[], now: Date, db: Db = getDb()): Promise<PackageRef[]> {
  const namesByEcosystem = new Map<Ecosystem, string[]>();
  for (const { ecosystem, name } of packages) {
    namesByEcosystem.set(ecosystem, [...(namesByEcosystem.get(ecosystem) ?? []), name]);
  }
  const fresh = new Set<string>();
  for (const [ecosystem, names] of namesByEcosystem) {
    const rows = await db
      .select({ name: packageMeta.name })
      .from(packageMeta)
      .where(and(eq(packageMeta.ecosystem, ecosystem), inArray(packageMeta.name, names), gt(packageMeta.expiresAt, now)));
    for (const row of rows) fresh.add(`${ecosystem}:${row.name}`);
  }
  const seen = new Set<string>();
  return packages.filter(({ ecosystem, name }) => {
    const key = `${ecosystem}:${name}`;
    if (fresh.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
