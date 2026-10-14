import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';

const searchRepoSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  homepage: z.string().nullish(),
  topics: z.array(z.string()).nullish(),
  language: z.string().nullish(),
  stargazers_count: z.number(),
  forks_count: z.number(),
  open_issues_count: z.number(),
  fork: z.boolean(),
  archived: z.boolean().nullish(),
  default_branch: z.string().nullish(),
  size: z.number().nullish(),
  license: z.object({ spdx_id: z.string().nullish() }).nullish(),
  created_at: z.string(),
  pushed_at: z.string().nullish(),
  owner: z.object({ id: z.number(), login: z.string() }),
});

const searchSchema = z.object({ total_count: z.number(), incomplete_results: z.boolean(), items: z.array(searchRepoSchema) });

export type SearchRepo = {
  githubId: number;
  fullName: string;
  name: string;
  ownerGithubId: number;
  description: string | null;
  homepage: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  sizeKb: number | null;
  licenseSpdx: string | null;
  createdAt: string;
  pushedAt: string | null;
};

// GitHub reports "no license detected" as this pseudo identifier.
const NO_LICENSE = 'NOASSERTION';

/**
 * One page of a repository search, best match first unless sorted. Searches are paced and
 * charged to the stricter search budget (CLAUDE.md §5.6).
 */
export async function searchRepositories(
  client: GitHubClient,
  query: string,
  options: RequestOptions & { perPage: number; page?: number; sort?: 'stars' | 'updated' },
): Promise<{ totalCount: number; repos: SearchRepo[] }> {
  const result = await client.search(
    'GET /search/repositories',
    { q: query, per_page: options.perPage, page: options.page ?? 1, ...(options.sort ? { sort: options.sort } : {}) },
    searchSchema,
    options,
  );
  return {
    totalCount: result.total_count,
    repos: result.items.map((item) => {
      const spdx = item.license?.spdx_id ?? null;
      return {
        githubId: item.id,
        fullName: item.full_name,
        name: item.name,
        ownerGithubId: item.owner.id,
        description: item.description ?? null,
        // GitHub sends an empty string for a repository without a website.
        homepage: item.homepage === '' ? null : (item.homepage ?? null),
        topics: item.topics ?? [],
        language: item.language ?? null,
        stars: item.stargazers_count,
        forks: item.forks_count,
        openIssues: item.open_issues_count,
        isFork: item.fork,
        isArchived: item.archived ?? false,
        defaultBranch: item.default_branch ?? null,
        sizeKb: item.size ?? null,
        licenseSpdx: spdx === NO_LICENSE ? null : spdx,
        createdAt: item.created_at,
        pushedAt: item.pushed_at ?? null,
      };
    }),
  };
}

/** How many public repositories GitHub has tagged with a topic (`topic:<slug>`). */
export async function countTopicRepositories(client: GitHubClient, slug: string, options: RequestOptions = {}): Promise<number> {
  const { totalCount } = await searchRepositories(client, `topic:${slug}`, { ...options, perPage: 1 });
  return totalCount;
}
