import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';

const accountSchema = z.object({ login: z.string(), id: z.number(), avatar_url: z.string().nullish(), type: z.string().nullish() });

const repositorySchema = z.object({
  id: z.number(),
  full_name: z.string(),
  private: z.boolean(),
  fork: z.boolean(),
  size: z.number(),
  default_branch: z.string(),
  parent: z.object({ full_name: z.string(), size: z.number() }).nullish(),
  name: z.string().nullish(),
  owner: z.object({ id: z.number() }).nullish(),
  description: z.string().nullish(),
  homepage: z.string().nullish(),
  topics: z.array(z.string()).nullish(),
  language: z.string().nullish(),
  stargazers_count: z.number().nullish(),
  forks_count: z.number().nullish(),
  open_issues_count: z.number().nullish(),
  archived: z.boolean().nullish(),
  license: z.object({ spdx_id: z.string().nullish() }).nullish(),
  created_at: z.string().nullish(),
  pushed_at: z.string().nullish(),
});

// GitHub reports "no license detected" as this pseudo identifier.
const NO_LICENSE = 'NOASSERTION';

export type Repository = {
  githubId: number;
  fullName: string;
  isPrivate: boolean;
  isFork: boolean;
  sizeKb: number;
  defaultBranch: string;
  parent: { fullName: string; sizeKb: number } | null;
  name: string;
  ownerGithubId: number | null;
  description: string | null;
  homepage: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  isArchived: boolean;
  licenseSpdx: string | null;
  createdAt: string | null;
  pushedAt: string | null;
};

/** One repository's metadata. Throws `GitHubNotFoundError` for a missing or private repository. */
export async function fetchRepository(client: GitHubClient, owner: string, repo: string, options: RequestOptions = {}): Promise<Repository> {
  return toRepository(await client.get('GET /repos/{owner}/{repo}', { owner, repo }, repositorySchema, { ...options, what: `${owner}/${repo}` }));
}

/** A repository by its GitHub id, which survives renames and transfers. */
export async function fetchRepositoryById(client: GitHubClient, githubId: number, options: RequestOptions = {}): Promise<Repository> {
  return toRepository(await client.get('GET /repositories/{id}', { id: githubId }, repositorySchema, { ...options, what: `repository ${githubId}` }));
}

function toRepository(data: z.infer<typeof repositorySchema>): Repository {
  return {
    githubId: data.id,
    fullName: data.full_name,
    isPrivate: data.private,
    isFork: data.fork,
    sizeKb: data.size,
    defaultBranch: data.default_branch,
    parent: data.parent ? { fullName: data.parent.full_name, sizeKb: data.parent.size } : null,
    name: data.name ?? data.full_name.split('/')[1] ?? data.full_name,
    ownerGithubId: data.owner?.id ?? null,
    description: data.description ?? null,
    homepage: data.homepage === '' ? null : (data.homepage ?? null),
    topics: data.topics ?? [],
    language: data.language ?? null,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    openIssues: data.open_issues_count ?? 0,
    isArchived: data.archived ?? false,
    licenseSpdx: data.license?.spdx_id && data.license.spdx_id !== NO_LICENSE ? data.license.spdx_id : null,
    createdAt: data.created_at ?? null,
    pushedAt: data.pushed_at ?? null,
  };
}

const contributorStatsSchema = z.array(
  z.object({
    author: accountSchema.nullish(),
    total: z.number(),
    weeks: z.array(z.object({ w: z.number(), a: z.number(), d: z.number(), c: z.number() })),
  }),
);

export type ContributorStats = {
  account: { login: string; githubId: number; avatarUrl: string | null; isBot: boolean } | null;
  total: number;
  /** Week start (Unix seconds, Sunday 00:00 UTC), additions, deletions, commits. */
  weeks: { week: number; additions: number; deletions: number; commits: number }[];
};

const isBotAccount = (account: z.infer<typeof accountSchema>) => account.type === 'Bot' || account.login.endsWith('[bot]');

/**
 * Commits and weekly lines per contributor, excluding merge and empty commits (CLAUDE.md §6.1).
 * GitHub may still be computing them (`pending`); for repositories with more than 10,000
 * commits it returns nothing (`[]`).
 */
export async function fetchContributorStats(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions = {},
): Promise<{ pending: true } | { pending: false; contributors: ContributorStats[] }> {
  const result = await client.stats('GET /repos/{owner}/{repo}/stats/contributors', { owner, repo }, contributorStatsSchema.or(z.object({}).transform(() => [])), {
    ...options,
    what: `${owner}/${repo}`,
  });
  if (result.pending) return { pending: true };
  return {
    pending: false,
    contributors: result.data.map((entry) => ({
      account: entry.author
        ? { login: entry.author.login, githubId: entry.author.id, avatarUrl: entry.author.avatar_url ?? null, isBot: isBotAccount(entry.author) }
        : null,
      total: entry.total,
      weeks: entry.weeks.map((week) => ({ week: week.w, additions: week.a, deletions: week.d, commits: week.c })),
    })),
  };
}

const commitSchema = z.object({
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string().nullish(), email: z.string().nullish(), date: z.string().nullish() }).nullish(),
  }),
  author: accountSchema.nullish(),
  parents: z.array(z.object({ sha: z.string() })),
});

export type CommitSummary = {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  date: string | null;
  account: { login: string; githubId: number; avatarUrl: string | null; isBot: boolean } | null;
  isMerge: boolean;
};

/** GitHub's largest page. */
const COMMITS_PER_PAGE = 100;

/**
 * The most recent commits on the default branch, newest first, up to `limit`; with `since` (an ISO
 * timestamp), only commits dated at or after it.
 */
export async function listCommits(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { limit: number; since?: string },
): Promise<{ commits: CommitSummary[]; truncated: boolean }> {
  if (options.limit <= 0) return { commits: [], truncated: false };
  const perPage = Math.min(COMMITS_PER_PAGE, options.limit);
  const params = options.since === undefined ? { owner, repo } : { owner, repo, since: options.since };
  const page = await client.paginate('GET /repos/{owner}/{repo}/commits', params, commitSchema, {
    ...options,
    what: `${owner}/${repo}`,
    perPage,
    maxPages: Math.ceil(options.limit / perPage),
  });
  const commits = page.items.slice(0, options.limit).map((item) => ({
    sha: item.sha,
    message: item.commit.message,
    authorName: item.commit.author?.name ?? null,
    authorEmail: item.commit.author?.email ?? null,
    date: item.commit.author?.date ?? null,
    account: item.author
      ? { login: item.author.login, githubId: item.author.id, avatarUrl: item.author.avatar_url ?? null, isBot: isBotAccount(item.author) }
      : null,
    isMerge: item.parents.length > 1,
  }));
  return { commits, truncated: page.truncated || page.items.length > options.limit };
}

const commitFilesSchema = z.object({
  files: z.array(z.object({ filename: z.string(), additions: z.number(), deletions: z.number() })).nullish(),
});

export type CommitFile = { path: string; additions: number; deletions: number };

/** The files one commit changed, with their line counts. */
export async function fetchCommitFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  sha: string,
  options: RequestOptions = {},
): Promise<CommitFile[]> {
  const data = await client.get('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref: sha }, commitFilesSchema, {
    ...options,
    what: `${owner}/${repo}@${sha.slice(0, 7)}`,
  });
  return (data.files ?? []).map((file) => ({ path: file.filename, additions: file.additions, deletions: file.deletions }));
}

const forkSchema = z.object({ full_name: z.string(), owner: z.object({ login: z.string() }), created_at: z.string().nullish() });

export type ForkSummary = { fullName: string; ownerLogin: string; createdAt: string | null };

/** A repository's forks, newest first, up to the page cap (`github.maxPages.default` unless given). */
export async function listForks(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<{ forks: ForkSummary[]; truncated: boolean }> {
  const page = await client.paginate('GET /repos/{owner}/{repo}/forks', { owner, repo, sort: 'newest' }, forkSchema, { ...options, what: `${owner}/${repo}` });
  return {
    forks: page.items.map((item) => ({ fullName: item.full_name, ownerLogin: item.owner.login, createdAt: item.created_at ?? null })),
    truncated: page.truncated,
  };
}

/**
 * A user's own public repositories, most recently pushed first, one page of up to `limit`
 * (§8 F18 "Crawl" step 4: metadata only). Throws `GitHubNotFoundError` for an account that is gone.
 */
export async function listUserRepos(client: GitHubClient, login: string, options: RequestOptions & { limit: number }): Promise<Repository[]> {
  const page = await client.paginate('GET /users/{username}/repos', { username: login, type: 'owner', sort: 'pushed' }, repositorySchema, {
    ...options,
    what: login,
    perPage: Math.min(COMMITS_PER_PAGE, options.limit),
    maxPages: 1,
  });
  return page.items.slice(0, options.limit).map(toRepository);
}
