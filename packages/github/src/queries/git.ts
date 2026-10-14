import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

export type TreeEntry = { path: string; type: 'blob' | 'tree' | 'other'; sha: string; size: number };

export type Tree = { entries: TreeEntry[]; /** GitHub returns at most a bounded tree; the rest is unknown. */ truncated: boolean };

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string(), size: z.number().nullish() })),
});

/** Asks for the blob's bytes as text instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';

/**
 * Every path in a repository at `ref`, in one call (`?recursive=1`). An empty repository
 * has no tree and lists as empty.
 */
export async function fetchTree(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  options: RequestOptions = {},
): Promise<Tree> {
  try {
    const tree = await client.get(
      'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
      { owner, repo, tree_sha: ref, recursive: 1 },
      treeSchema,
      { ...options, what: `${owner}/${repo}` },
    );
    return {
      truncated: tree.truncated,
      entries: tree.tree.map((entry) => ({
        path: entry.path,
        type: entry.type === 'blob' || entry.type === 'tree' ? entry.type : 'other',
        sha: entry.sha,
        size: entry.size ?? 0,
      })),
    };
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return { entries: [], truncated: false };
    throw error;
  }
}

/** A file's content by blob sha, as text. `null` when the blob no longer exists. */
export async function fetchBlobText(
  client: GitHubClient,
  owner: string,
  repo: string,
  sha: string,
  options: RequestOptions = {},
): Promise<string | null> {
  try {
    return await client.get('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', { owner, repo, file_sha: sha }, z.string(), {
      ...options,
      accept: RAW_MEDIA_TYPE,
      what: `${owner}/${repo}`,
    });
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}
