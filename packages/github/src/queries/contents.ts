import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string(),
  sha: z.string(),
  size: z.number().nullish(),
});

export type RootEntry = { name: string; path: string; type: 'file' | 'dir' | 'other'; sha: string; size: number };

/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';

/** Lists a repository's root directory. An empty repository has no contents and lists as empty. */
export async function listRootEntries(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions = {},
): Promise<RootEntry[]> {
  try {
    const entries = await client.get('GET /repos/{owner}/{repo}/contents', { owner, repo }, z.array(entrySchema), {
      ...options,
      what: `${owner}/${repo}`,
    });
    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === 'file' || entry.type === 'dir' ? entry.type : 'other',
      sha: entry.sha,
      size: entry.size ?? 0,
    }));
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return [];
    throw error;
  }
}

/** Reads one file as text. Returns `null` when it no longer exists. */
export async function fetchFileText(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string,
  options: RequestOptions = {},
): Promise<string | null> {
  try {
    return await client.get(
      // {+path}: reserved expansion keeps the slashes of a nested path unencoded.
      'GET /repos/{owner}/{repo}/contents/{+path}',
      { owner, repo, path },
      z.string(),
      { ...options, accept: RAW_MEDIA_TYPE, what: `${owner}/${repo}/${path}` },
    );
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}

/**
 * A repository's README as GitHub picks it (any name and format GitHub recognizes), as
 * text. `null` when the repository has none.
 */
export async function fetchReadme(
  client: GitHubClient,
  owner: string,
  repo: string,
  options: RequestOptions = {},
): Promise<string | null> {
  try {
    return await client.get('GET /repos/{owner}/{repo}/readme', { owner, repo }, z.string(), {
      ...options,
      accept: RAW_MEDIA_TYPE,
      what: `${owner}/${repo}`,
    });
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}
