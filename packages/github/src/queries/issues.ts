import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

const issueSearchSchema = z.object({
  total_count: z.number(),
  items: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      html_url: z.string(),
      repository_url: z.string(),
      comments: z.number(),
      created_at: z.string(),
      labels: z.array(z.object({ name: z.string() }).or(z.string())).nullish(),
      closed_at: z.string().nullish(),
      pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
    }),
  ),
});

export type FoundIssue = {
  repo: string;
  number: number;
  title: string;
  url: string;
  comments: number;
  createdAt: string;
  labels: string[];
  closedAt: string | null;
  /** For a pull request: when it was merged, if it was. */
  mergedAt: string | null;
};

/** One page of an issue search (CLAUDE.md §8 F8 step 1). Searches are paced like every search. */
export async function searchIssues(
  client: GitHubClient,
  query: string,
  options: RequestOptions & { perPage: number; page?: number },
): Promise<{ totalCount: number; issues: FoundIssue[] }> {
  const result = await client.search('GET /search/issues', { q: query, per_page: options.perPage, page: options.page ?? 1 }, issueSearchSchema, options);
  return {
    totalCount: result.total_count,
    issues: result.items.map((item) => ({
      // repository_url is https://api.github.com/repos/<owner>/<repo>.
      repo: item.repository_url.split('/repos/')[1] ?? item.repository_url,
      number: item.number,
      title: item.title,
      url: item.html_url,
      comments: item.comments,
      createdAt: item.created_at,
      labels: (item.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
      closedAt: item.closed_at ?? null,
      mergedAt: item.pull_request?.merged_at ?? null,
    })),
  };
}

const labelSchema = z.array(z.object({ name: z.string() }));

/** A repository's label names (first page of 100). */
export async function fetchLabels(client: GitHubClient, owner: string, repo: string, options: RequestOptions = {}): Promise<string[]> {
  try {
    const labels = await client.get('GET /repos/{owner}/{repo}/labels', { owner, repo, per_page: 100 }, labelSchema, { ...options, what: `${owner}/${repo}` });
    return labels.map((label) => label.name);
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return [];
    throw error;
  }
}

const recentIssuesSchema = z.array(
  z.object({ number: z.number(), created_at: z.string(), author_association: z.string(), pull_request: z.unknown().optional() }),
);
const recentCommentsSchema = z.array(z.object({ issue_url: z.string(), created_at: z.string(), author_association: z.string() }));

export type IssueWithReply = { createdAt: string; authorAssociation: string; firstMaintainerReplyAt: string | null };

/**
 * The latest `count` issues (any state, without pull requests) with the time of the first
 * comment by an owner, member or collaborator, from the latest comments on the repository.
 * Two requests per repository instead of one per issue.
 */
export async function fetchIssueResponses(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions & { count: number; maintainerRoles: readonly string[] },
): Promise<IssueWithReply[]> {
  const what = `${owner}/${repo}`;
  try {
    const issues = (
      await client.get('GET /repos/{owner}/{repo}/issues', { owner, repo, state: 'all', per_page: 100 }, recentIssuesSchema, { ...options, what })
    )
      .filter((issue) => issue.pull_request === undefined)
      .slice(0, options.count);
    const comments = await client.get(
      'GET /repos/{owner}/{repo}/issues/comments',
      { owner, repo, sort: 'created', direction: 'desc', per_page: 100 },
      recentCommentsSchema,
      { ...options, what },
    );
    const firstReply = new Map<number, string>();
    for (const comment of comments) {
      if (!options.maintainerRoles.includes(comment.author_association)) continue;
      const number = Number(comment.issue_url.split('/').pop());
      const known = firstReply.get(number);
      if (known === undefined || comment.created_at < known) firstReply.set(number, comment.created_at);
    }
    return issues.map((issue) => ({
      createdAt: issue.created_at,
      authorAssociation: issue.author_association,
      firstMaintainerReplyAt: firstReply.get(issue.number) ?? null,
    }));
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return [];
    throw error;
  }
}
