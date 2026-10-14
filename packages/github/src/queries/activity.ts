import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

/** GitHub's largest page. */
const PAGE = 100;
/** Asks for star timestamps along with the stargazers. */
const STAR_MEDIA_TYPE = 'application/vnd.github.star+json';

const what = (owner: string, repo: string) => `${owner}/${repo}`;

/** Runs a read that may fail because the repository is empty or gone; those count as "nothing". */
async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return empty;
    throw error;
  }
}

const contributorSchema = z.array(z.object({ contributions: z.number() })).or(z.null().transform(() => []));

/**
 * Commits on the default branch, estimated from the contributors list including anonymous
 * authors (first page): exact for repositories with up to 100 contributors.
 */
export function fetchCommitEstimate(client: GitHubClient, owner: string, repo: string, options: RequestOptions = {}): Promise<number> {
  return orEmpty(async () => {
    const contributors = await client.get('GET /repos/{owner}/{repo}/contributors', { owner, repo, anon: 1, per_page: PAGE }, contributorSchema, {
      ...options,
      what: what(owner, repo),
    });
    return contributors.reduce((total, entry) => total + entry.contributions, 0);
  }, 0);
}

const commitMessageSchema = z.array(z.object({ commit: z.object({ message: z.string(), author: z.object({ date: z.string().nullish() }).nullish() }) }));

/** The latest commit messages with their dates, newest first. */
export function fetchRecentCommits(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { count: number },
): Promise<{ message: string; date: string | null }[]> {
  return orEmpty(async () => {
    const commits = await client.get('GET /repos/{owner}/{repo}/commits', { owner, repo, per_page: options.count }, commitMessageSchema, {
      ...options,
      what: what(owner, repo),
    });
    return commits.map((item) => ({ message: item.commit.message, date: item.commit.author?.date ?? null }));
  }, []);
}

const listSchema = z.array(z.looseObject({}));

/** True when the repository has published a release or at least one tag. */
export async function fetchHasReleases(client: GitHubClient, owner: string, repo: string, options: RequestOptions = {}): Promise<boolean> {
  const releases = await orEmpty(
    () => client.get('GET /repos/{owner}/{repo}/releases', { owner, repo, per_page: 1 }, listSchema, { ...options, what: what(owner, repo) }),
    [],
  );
  if (releases.length > 0) return true;
  const tags = await orEmpty(
    () => client.get('GET /repos/{owner}/{repo}/tags', { owner, repo, per_page: 1 }, listSchema, { ...options, what: what(owner, repo) }),
    [],
  );
  return tags.length > 0;
}

const issueSchema = z.array(
  z.object({ state: z.string(), comments: z.number(), pull_request: z.unknown().optional(), created_at: z.string() }),
);

export type IssueSample = {
  /** Issues (not pull requests) among the latest 100, open and closed. */
  total: number;
  allClosed: boolean;
  /** The latest open issues, newest first, with their comment counts. */
  open: { comments: number; createdAt: string }[];
};

/** The latest issues of a repository, without pull requests. */
export function fetchIssueSample(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { openCount: number },
): Promise<IssueSample> {
  return orEmpty(async () => {
    const items = await client.get('GET /repos/{owner}/{repo}/issues', { owner, repo, state: 'all', per_page: PAGE }, issueSchema, {
      ...options,
      what: what(owner, repo),
    });
    const issues = items.filter((item) => item.pull_request === undefined);
    return {
      total: issues.length,
      allClosed: issues.every((issue) => issue.state === 'closed'),
      open: issues
        .filter((issue) => issue.state === 'open')
        .slice(0, options.openCount)
        .map((issue) => ({ comments: issue.comments, createdAt: issue.created_at })),
    };
  }, { total: 0, allClosed: true, open: [] });
}

const stargazerSchema = z.array(z.object({ starred_at: z.string() }));

/**
 * Stars received after `since`. Stargazers are listed oldest first, so the newest page is
 * read first and earlier pages only while every star on a page is newer; at most `maxPages`.
 */
export async function fetchStarsSince(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { since: Date; totalStars: number; maxPages: number },
): Promise<number> {
  let count = 0;
  for (let page = Math.ceil(options.totalStars / PAGE), read = 0; page >= 1 && read < options.maxPages; page -= 1, read += 1) {
    const stars = await orEmpty(
      () =>
        client.get('GET /repos/{owner}/{repo}/stargazers', { owner, repo, per_page: PAGE, page }, stargazerSchema, {
          ...options,
          accept: STAR_MEDIA_TYPE,
          what: what(owner, repo),
        }),
      [],
    );
    const newer = stars.filter((star) => new Date(star.starred_at) > options.since).length;
    count += newer;
    if (newer < stars.length || stars.length === 0) break;
  }
  return count;
}
