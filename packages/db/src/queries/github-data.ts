import { and, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { analysisCache, apiCache, ghRepos, ghUsers, githubIdentities, metricSamples, repoDependencies, repoManifests } from '../schema';

import { hashSubject } from './security';

export type GhUserInput = Omit<typeof ghUsers.$inferInsert, 'createdAt'>;
export type GhRepoInput = Omit<typeof ghRepos.$inferInsert, 'createdAt' | 'searchTsv'>;

/** True when a GitHub account belongs to someone who has signed up. */
export async function isMemberGithubId(githubId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .select({ userId: githubIdentities.userId })
    .from(githubIdentities)
    .where(eq(githubIdentities.githubId, githubId))
    .limit(1);
  return rows.length > 0;
}

export async function upsertGhUser(user: GhUserInput, db: DbOrTx = getDb()): Promise<void> {
  const { githubId, ...values } = user;
  // A renamed account can leave its old login on another row; logins are unique.
  await db.delete(ghUsers).where(and(eq(ghUsers.login, user.login), sql`${ghUsers.githubId} <> ${githubId}`));
  await db
    .insert(ghUsers)
    .values(user)
    .onConflictDoUpdate({
      target: ghUsers.githubId,
      // Membership in the country index is set by the crawler and survives a profile refresh.
      set: { ...values, inCountryIndex: sql`${ghUsers.inCountryIndex} or excluded.in_country_index` },
    });
}

export async function upsertGhRepos(repos: readonly GhRepoInput[], db: DbOrTx = getDb()): Promise<void> {
  if (repos.length === 0) return;
  // A renamed or transferred repository can leave its old full name on another row.
  await db.delete(ghRepos).where(
    and(
      inArray(
        ghRepos.fullName,
        repos.map((repo) => repo.fullName),
      ),
      notInArray(
        ghRepos.githubId,
        repos.map((repo) => repo.githubId),
      ),
    ),
  );
  await db
    .insert(ghRepos)
    .values([...repos])
    .onConflictDoUpdate({
      target: ghRepos.githubId,
      set: {
        ownerGithubId: sql`excluded.owner_github_id`,
        fullName: sql`excluded.full_name`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        homepage: sql`excluded.homepage`,
        topics: sql`excluded.topics`,
        primaryLanguage: sql`excluded.primary_language`,
        languages: sql`excluded.languages`,
        stars: sql`excluded.stars`,
        forks: sql`excluded.forks`,
        openIssues: sql`excluded.open_issues`,
        licenseSpdx: sql`excluded.license_spdx`,
        isFork: sql`excluded.is_fork`,
        isArchived: sql`excluded.is_archived`,
        defaultBranch: sql`excluded.default_branch`,
        sizeKb: sql`excluded.size_kb`,
        ghCreatedAt: sql`excluded.gh_created_at`,
        pushedAt: sql`excluded.pushed_at`,
        fetchedAt: sql`excluded.fetched_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    });
}

export async function getRepoManifests(repoGithubId: number, db: DbOrTx = getDb()) {
  return db.select().from(repoManifests).where(eq(repoManifests.repoGithubId, repoGithubId));
}

export type ManifestInput = {
  path: string;
  ecosystem: string;
  blobSha: string;
  dependencies: readonly { name: string; isDev: boolean }[];
};

/**
 * Replaces everything known about a repository's manifests and dependencies with the
 * given set. A package declared by two manifests is a runtime dependency if either says so.
 */
export async function replaceRepoManifests(
  repoGithubId: number,
  manifests: readonly ManifestInput[],
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(repoManifests).where(eq(repoManifests.repoGithubId, repoGithubId));
    await tx.delete(repoDependencies).where(eq(repoDependencies.repoGithubId, repoGithubId));
    if (manifests.length === 0) return;

    await tx.insert(repoManifests).values(
      manifests.map((manifest) => ({
        repoGithubId,
        path: manifest.path,
        ecosystem: manifest.ecosystem,
        blobSha: manifest.blobSha,
        fetchedAt: now,
      })),
    );
    const merged = new Map<string, { ecosystem: string; packageName: string; isDev: boolean }>();
    for (const manifest of manifests) {
      for (const dependency of manifest.dependencies) {
        const key = `${manifest.ecosystem}:${dependency.name}`;
        const existing = merged.get(key);
        merged.set(key, {
          ecosystem: manifest.ecosystem,
          packageName: dependency.name,
          isDev: existing ? existing.isDev && dependency.isDev : dependency.isDev,
        });
      }
    }
    if (merged.size > 0) {
      await tx.insert(repoDependencies).values([...merged.values()].map((row) => ({ repoGithubId, ...row })));
    }
  });
}

export async function getRepoDependencies(repoGithubIds: readonly number[], db: DbOrTx = getDb()) {
  if (repoGithubIds.length === 0) return [];
  return db
    .select()
    .from(repoDependencies)
    .where(inArray(repoDependencies.repoGithubId, [...repoGithubIds]));
}

export type PurgeReport = { users: number; repos: number; analyses: number; apiResponses: number };

/**
 * Deletes raw cached data about people who are not members once it has expired
 * (CLAUDE.md §5.12, class C). Members and the country index are never touched: their
 * rows carry no expiry.
 */
export async function purgeNonMemberRaw(now: Date, db: DbOrTx = getDb()): Promise<PurgeReport> {
  const repos = await db
    .delete(ghRepos)
    .where(and(isNotNull(ghRepos.expiresAt), lt(ghRepos.expiresAt, now)))
    .returning({ id: ghRepos.githubId });
  const users = await db
    .delete(ghUsers)
    .where(and(isNotNull(ghUsers.expiresAt), lt(ghUsers.expiresAt, now), eq(ghUsers.isMember, false), eq(ghUsers.inCountryIndex, false)))
    .returning({ id: ghUsers.githubId });
  const analyses = await db.delete(analysisCache).where(lt(analysisCache.expiresAt, now)).returning({ kind: analysisCache.kind });
  const apiResponses = await db
    .delete(apiCache)
    .where(and(isNotNull(apiCache.expiresAt), lt(apiCache.expiresAt, now)))
    .returning({ url: apiCache.url });
  return { users: users.length, repos: repos.length, analyses: analyses.length, apiResponses: apiResponses.length };
}

/**
 * Records anonymous samples for a person (CLAUDE.md §5.12). The subject hash is salted
 * and exists only so one person counts once per metric and salt period; a repeat is ignored.
 */
export async function recordMetricSamples(
  githubId: number,
  samples: Readonly<Record<string, number>>,
  now: Date,
  db: DbOrTx = getDb(),
): Promise<number> {
  const entries = Object.entries(samples).filter(([, value]) => Number.isFinite(value));
  if (entries.length === 0) return 0;
  const { subjectHash, saltPeriod } = await hashSubject(githubId, now, db);
  const inserted = await db
    .insert(metricSamples)
    .values(
      entries.map(([metricKey, value]) => ({
        metricKey,
        value,
        subjectHash,
        saltPeriod,
        recordedOn: now.toISOString().slice(0, ISO_DATE_LENGTH),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: metricSamples.id });
  return inserted.length;
}

/** Characters of an ISO timestamp that make up `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;
