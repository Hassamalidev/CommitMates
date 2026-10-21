import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';

const userSchema = z.object({ login: z.string() }).nullish();

const pullSchema = z.object({
  number: z.number(),
  state: z.string(),
  merged: z.boolean().nullish(),
  title: z.string().nullish(),
  html_url: z.string().nullish(),
  user: userSchema,
  author_association: z.string().nullish(),
  base: z.object({ repo: z.object({ full_name: z.string(), private: z.boolean(), owner: z.object({ login: z.string() }) }) }),
});

export type PullRequest = {
  number: number;
  /** `open` or `closed`; a merged pull request is closed and `merged`. */
  state: 'open' | 'closed';
  merged: boolean;
  title: string | null;
  htmlUrl: string | null;
  authorLogin: string | null;
  authorAssociation: string | null;
  repoFullName: string;
  repoOwnerLogin: string;
  isPrivate: boolean;
};

/** One pull request. Throws `GitHubNotFoundError` when it, or its repository, is missing or private. */
export async function fetchPullRequest(client: GitHubClient, owner: string, repo: string, pullNumber: number, options: RequestOptions = {}): Promise<PullRequest> {
  const data = await client.get('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo, pull_number: pullNumber }, pullSchema, {
    ...options,
    what: `${owner}/${repo}#${pullNumber}`,
  });
  return {
    number: data.number,
    state: data.state === 'open' ? 'open' : 'closed',
    merged: data.merged ?? false,
    title: data.title ?? null,
    htmlUrl: data.html_url ?? null,
    authorLogin: data.user?.login ?? null,
    authorAssociation: data.author_association ?? null,
    repoFullName: data.base.repo.full_name,
    repoOwnerLogin: data.base.repo.owner.login,
    isPrivate: data.base.repo.private,
  };
}

const fileSchema = z.object({ filename: z.string() });

/** Paths of the files a pull request changes, up to the page cap. */
export async function listPullRequestFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  pullNumber: number,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<{ paths: string[]; truncated: boolean }> {
  const page = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', { owner, repo, pull_number: pullNumber }, fileSchema, {
    ...options,
    what: `${owner}/${repo}#${pullNumber}`,
  });
  return { paths: page.items.map((item) => item.filename), truncated: page.truncated };
}

const reviewSchema = z.object({ id: z.number(), user: userSchema, state: z.string(), submitted_at: z.string().nullish() });

export type PullReview = { id: number; login: string | null; state: string; submittedAt: string | null };

/** The reviews submitted on a pull request (pending drafts have no submission time). */
export async function listPullRequestReviews(
  client: GitHubClient,
  owner: string,
  repo: string,
  pullNumber: number,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<PullReview[]> {
  const page = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { owner, repo, pull_number: pullNumber }, reviewSchema, {
    ...options,
    what: `${owner}/${repo}#${pullNumber}`,
  });
  return page.items.map((item) => ({ id: item.id, login: item.user?.login ?? null, state: item.state, submittedAt: item.submitted_at ?? null }));
}

const reviewCommentSchema = z.object({ id: z.number(), user: userSchema, created_at: z.string(), pull_request_review_id: z.number().nullish() });

export type PullReviewComment = { id: number; login: string | null; createdAt: string; reviewId: number | null };

/** Line comments on a pull request's diff. */
export async function listPullRequestReviewComments(
  client: GitHubClient,
  owner: string,
  repo: string,
  pullNumber: number,
  options: RequestOptions & { maxPages?: number } = {},
): Promise<PullReviewComment[]> {
  const page = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', { owner, repo, pull_number: pullNumber }, reviewCommentSchema, {
    ...options,
    what: `${owner}/${repo}#${pullNumber}`,
  });
  return page.items.map((item) => ({ id: item.id, login: item.user?.login ?? null, createdAt: item.created_at, reviewId: item.pull_request_review_id ?? null }));
}
