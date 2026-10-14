import { z } from 'zod';

import type { GitHubClient, RequestOptions } from '../client';

const eventSchema = z.object({
  type: z.string().nullable(),
  created_at: z.string().nullable(),
  repo: z.object({ name: z.string() }),
  payload: z
    .object({
      size: z.number().nullish(),
      commits: z.array(z.object({ message: z.string().nullish() })).nullish(),
    })
    .nullish(),
});

export type ActivityKind = 'push' | 'pull_request' | 'issue' | 'review' | 'create';

export type ActivityEvent = {
  kind: ActivityKind;
  createdAt: string;
  /** `owner/repo` the event happened in. */
  repo: string;
  /** Commits in a push; 0 for other kinds. */
  commits: number;
  /** Commit messages of a push, as GitHub includes them in the event. */
  messages: string[];
};

// GitHub's event type names (protocol constants) and the kinds we keep (CLAUDE.md §8 F1 step 4).
const KIND_BY_TYPE: Readonly<Record<string, ActivityKind>> = {
  PushEvent: 'push',
  PullRequestEvent: 'pull_request',
  IssuesEvent: 'issue',
  PullRequestReviewEvent: 'review',
  CreateEvent: 'create',
};

/** The events API serves at most 300 events in pages of up to 100. */
const EVENTS_PER_PAGE = 100;
const EVENTS_MAX_PAGES = 3;

/**
 * A person's recent public activity. GitHub keeps roughly the last 90 days and at most
 * 300 events, so everything built on this must say "last 90 days" (CLAUDE.md §6.1).
 */
export async function fetchPublicEvents(client: GitHubClient, login: string, options: RequestOptions = {}): Promise<ActivityEvent[]> {
  const page = await client.paginate('GET /users/{username}/events/public', { username: login }, eventSchema, {
    ...options,
    what: `@${login}`,
    perPage: EVENTS_PER_PAGE,
    maxPages: EVENTS_MAX_PAGES,
  });
  const events: ActivityEvent[] = [];
  for (const event of page.items) {
    const kind = event.type === null ? undefined : KIND_BY_TYPE[event.type];
    if (kind === undefined || event.created_at === null) continue;
    const messages = (event.payload?.commits ?? []).flatMap((commit) => (commit.message ? [commit.message] : []));
    events.push({
      kind,
      createdAt: event.created_at,
      repo: event.repo.name,
      commits: kind === 'push' ? (event.payload?.size ?? messages.length) : 0,
      messages: kind === 'push' ? messages : [],
    });
  }
  return events;
}
