import {
  getCachedAnalysis,
  getPackageTags,
  getRepoDependencies,
  getSetting,
  putCachedAnalysis,
  replaceRepoPaths,
  upsertGhRepos,
} from '@commitmates/db';
import { fetchHasReleases, listDirectory, listRootEntries, type GitHubClient } from '@commitmates/github';
import { z } from 'zod';

import { ingestRepoManifests } from '../profiles/ingest';
import { requestEnrichment } from '../sources/jobs';

const MS_PER_HOUR = 3_600_000; // allowed-literal: unit conversion
const FACETS_KIND = 'repo_facets';
/** The CI directory that counts as its own feature (§8 F5 step 1). */
const WORKFLOWS = '.github/workflows';

/** What the Gap Finder needs to know about any repository, self or peer. */
export type FacetRepo = {
  githubId: number;
  fullName: string;
  name: string;
  ownerGithubId: number | null;
  description: string | null;
  homepage: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  licenseSpdx: string | null;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  sizeKb: number | null;
  createdAt: string | null;
  pushedAt: string | null;
};

export const repoFacetsSchema = z.object({
  paths: z.array(z.string()),
  tags: z.array(z.string()),
  meta: z.array(z.string()),
});
export type RepoFacets = z.infer<typeof repoFacetsSchema>;

/** Every facet of a repository as one set: paths, `tag:<derived tag>` and `meta:<property>`. */
export const allFacets = (facets: RepoFacets): string[] => [...facets.paths, ...facets.tags.map((tag) => `tag:${tag}`), ...facets.meta];

const key = (fullName: string) => ({ kind: FACETS_KIND, subjectKey: fullName.toLowerCase(), paramsHash: 'default' });

/**
 * A repository's facets (CLAUDE.md §8 F5 step 1): every root entry as `dir:` or `file:`,
 * `dir:.github/workflows` when it exists, the derived tags of its dependencies, and whether
 * it has a license, website, releases, topics and description. Cached for `cache.gapTtlHours`;
 * paths and manifests are stored for reuse.
 */
export async function readRepoFacets(client: GitHubClient, repo: FacetRepo, now: Date, deadline: number): Promise<RepoFacets> {
  const cached = repoFacetsSchema.safeParse((await getCachedAnalysis(key(repo.fullName), now))?.result);
  if (cached.success) return cached.data;

  const [owner = '', name = ''] = repo.fullName.split('/');
  const request = { deadline };
  const [ttlHours, nonUserTtlHours] = await Promise.all([getSetting('cache.gapTtlHours'), getSetting('privacy.nonUserRawTtlHours')]);

  const root = await listRootEntries(client, owner, name, request);
  const paths = root.map((entry) => `${entry.type === 'dir' ? 'dir' : 'file'}:${entry.name.toLowerCase()}`);
  if (root.some((entry) => entry.type === 'dir' && entry.name === '.github')) {
    const workflows = await listDirectory(client, owner, name, WORKFLOWS, request);
    if (workflows.length > 0) paths.push(`dir:${WORKFLOWS}`);
  }

  await upsertGhRepos([
    {
      githubId: repo.githubId,
      ownerGithubId: repo.ownerGithubId ?? 0,
      fullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      homepage: repo.homepage,
      topics: repo.topics,
      primaryLanguage: repo.language,
      languages: {},
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      licenseSpdx: repo.licenseSpdx,
      isFork: repo.isFork,
      isArchived: repo.isArchived,
      defaultBranch: repo.defaultBranch,
      sizeKb: repo.sizeKb,
      ghCreatedAt: repo.createdAt ? new Date(repo.createdAt) : now,
      pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + nonUserTtlHours * MS_PER_HOUR),
    },
  ]);
  await replaceRepoPaths(repo.githubId, paths);
  await ingestRepoManifests(client, repo, now, deadline);
  const dependencies = await getRepoDependencies([repo.githubId]);
  const refs = dependencies.map((row) => ({ ecosystem: row.ecosystem, name: row.packageName }));
  await requestEnrichment(refs as Parameters<typeof requestEnrichment>[0], now);
  const tagsByPackage = await getPackageTags(refs);
  const tags = [...new Set([...tagsByPackage.values()].flat())].sort();

  const meta = [
    ...(repo.licenseSpdx ? ['meta:license'] : []),
    ...(repo.homepage ? ['meta:homepage'] : []),
    ...((await fetchHasReleases(client, owner, name, request)) ? ['meta:releases'] : []),
    ...(repo.topics.length > 0 ? ['meta:topics'] : []),
    ...(repo.description?.trim() ? ['meta:description'] : []),
  ];

  const facets: RepoFacets = { paths: [...new Set(paths)].sort(), tags, meta };
  await putCachedAnalysis({
    ...key(repo.fullName),
    result: facets,
    isMemberSubject: false,
    computedAt: now,
    expiresAt: new Date(now.getTime() + ttlHours * MS_PER_HOUR),
  });
  return facets;
}
