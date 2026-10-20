import { z } from 'zod';

import { RATE_LIMIT_FRAGMENT, type GitHubClient, type RequestOptions } from '../client';
import { GitHubNotFoundError } from '../errors';

export const CONTRIBUTION_DAYS_QUERY = `
query ContributionDays($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
  }
  ${RATE_LIMIT_FRAGMENT}
}`;

const responseSchema = z.object({
  user: z
    .object({
      contributionsCollection: z.object({
        contributionCalendar: z.object({
          weeks: z.array(z.object({ contributionDays: z.array(z.object({ date: z.string(), contributionCount: z.number() })) })),
        }),
      }),
    })
    .nullable(),
});

/**
 * A member's contribution count per calendar day from `from` to `to` (inclusive dates, at most a year),
 * as GitHub's contribution calendar reports them: its day boundaries follow GitHub's handling of the
 * account's timezone, and private counts are included when the member enabled them (CLAUDE.md §8 F13).
 */
export async function fetchContributionDays(
  client: GitHubClient,
  login: string,
  from: string,
  to: string,
  options: RequestOptions = {},
): Promise<Map<string, number>> {
  const data = await client.graphql(
    CONTRIBUTION_DAYS_QUERY,
    { login, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
    responseSchema,
    { ...options, what: `@${login}` },
  );
  if (!data.user) throw new GitHubNotFoundError(`@${login}`);
  const days = new Map<string, number>();
  for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
    for (const day of week.contributionDays) if (day.date >= from && day.date <= to) days.set(day.date, day.contributionCount);
  }
  return days;
}
