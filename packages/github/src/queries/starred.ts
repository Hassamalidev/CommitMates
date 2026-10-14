import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';

export type StarredRepo = { fullName: string; topics: string[] };

const starredSchema = z.object({
  full_name: z.string(),
  topics: z.array(z.string()).nullish(),
});

/** GitHub's largest page. */
const STARRED_PER_PAGE = 100;

/**
 * The repositories a person starred most recently, newest first, with their topics
 * (CLAUDE.md §8 F2 "Data"). `cap` bounds how many are read (`matching.starCap`).
 */
export async function fetchStarredRepos(
  client: GitHubClient,
  login: string,
  options: RequestOptions & { cap: number },
): Promise<StarredRepo[]> {
  if (options.cap <= 0) return [];
  const perPage = Math.min(STARRED_PER_PAGE, options.cap);
  const page = await client.paginate(
    'GET /users/{username}/starred',
    { username: login, sort: 'created', direction: 'desc' },
    starredSchema,
    { ...options, what: `@${login}`, perPage, maxPages: Math.ceil(options.cap / perPage) },
  );
  return page.items.slice(0, options.cap).map((repo) => ({ fullName: repo.full_name.toLowerCase(), topics: repo.topics ?? [] }));
}
