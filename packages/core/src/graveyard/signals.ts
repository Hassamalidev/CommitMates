import { adjustedUnfinished, commitUnfinishedSignal, readmeUnfinishedSignal, unfinishedScore } from '@commitmates/algorithms';
import { getCachedAnalysis, getSetting, putCachedAnalysis } from '@commitmates/db';
import {
  fetchCommitEstimate,
  fetchHasReleases,
  fetchIssueSample,
  fetchReadme,
  fetchRecentCommits,
  fetchStarsSince,
  type GitHubClient,
} from '@commitmates/github';
import { z } from 'zod';

const MS_PER_HOUR = 3_600_000; // allowed-literal: unit conversion
/** Issues and commit messages read per repository (§8 F7 step 5: "the last 10"). */
export const SIGNAL_SAMPLE = 10;
/** Stargazer pages read from the newest backwards for recent stars. */
const STAR_PAGES = 2;
const SIGNALS_KIND = 'graveyard_signals';

export const repoSignalsSchema = z.object({
  hasReadme: z.boolean(),
  readme: z.string(),
  commitEstimate: z.number().int().min(0),
  commitMessages: z.array(z.string()),
  hasReleases: z.boolean(),
  issues: z.object({ total: z.number().int(), allClosed: z.boolean(), openComments: z.array(z.number().int()) }),
  /** Stars since the last push; read only for the top candidates. */
  recentStars: z.number().int().min(0).nullable(),
  /** Only the README and the commit estimate were read: the candidate failed the Graveyard's filters. */
  partial: z.boolean().optional(),
});
export type RepoSignals = z.infer<typeof repoSignalsSchema>;

/** README text kept per repository: enough for the signals, not a copy of the project. */
const MAX_README_CHARS = 20_000;

const key = (fullName: string) => ({ kind: SIGNALS_KIND, subjectKey: fullName.toLowerCase(), paramsHash: 'default' });

async function store(fullName: string, signals: RepoSignals, now: Date): Promise<void> {
  const ttlHours = await getSetting('cache.searchTtlHours');
  await putCachedAnalysis({
    ...key(fullName),
    result: signals,
    isMemberSubject: false,
    computedAt: now,
    expiresAt: new Date(now.getTime() + ttlHours * MS_PER_HOUR),
  });
}

/**
 * What the Graveyard reads about one repository (CLAUDE.md §8 F7 steps 4–5), cached for
 * `cache.searchTtlHours` so overlapping searches and continuations do not read it twice.
 */
export async function repoSignals(
  client: GitHubClient,
  fullName: string,
  now: Date,
  deadline: number,
  options: { minCommits?: number } = {},
): Promise<RepoSignals> {
  const cached = repoSignalsSchema.safeParse((await getCachedAnalysis(key(fullName), now))?.result);
  // A partial reading serves only callers that filter the same way.
  if (cached.success && !(cached.data.partial === true && options.minCommits === undefined)) return cached.data;
  const [owner = '', name = ''] = fullName.split('/');
  const request = { deadline };
  const [readme, commitEstimate] = await Promise.all([fetchReadme(client, owner, name, request), fetchCommitEstimate(client, owner, name, request)]);
  // A candidate without a README or with too short a history is filtered out (§8 F7 step 4): the
  // rest of its signals would never be shown, so they are not read (ADR-014).
  if (options.minCommits !== undefined && (readme === null || commitEstimate < options.minCommits)) {
    const filtered: RepoSignals = {
      hasReadme: readme !== null,
      readme: '',
      commitEstimate,
      commitMessages: [],
      hasReleases: false,
      issues: { total: 0, allClosed: false, openComments: [] },
      recentStars: null,
      partial: true,
    };
    await store(fullName, filtered, now);
    return filtered;
  }
  const [commits, hasReleases, issues] = [
    await fetchRecentCommits(client, owner, name, { ...request, count: SIGNAL_SAMPLE }),
    await fetchHasReleases(client, owner, name, request),
    await fetchIssueSample(client, owner, name, { ...request, openCount: SIGNAL_SAMPLE }),
  ];
  const signals: RepoSignals = {
    hasReadme: readme !== null,
    readme: (readme ?? '').slice(0, MAX_README_CHARS),
    commitEstimate,
    commitMessages: commits.map((commit) => commit.message),
    hasReleases,
    issues: { total: issues.total, allClosed: issues.allClosed, openComments: issues.open.map((issue) => issue.comments) },
    recentStars: null,
  };
  await store(fullName, signals, now);
  return signals;
}

/** Adds the stars received since the last push to a repository's cached signals. */
export async function withRecentStars(
  client: GitHubClient,
  repo: { fullName: string; stars: number; pushedAt: string | null },
  signals: RepoSignals,
  now: Date,
  deadline: number,
): Promise<RepoSignals> {
  if (signals.recentStars !== null || repo.pushedAt === null) return signals;
  const [owner = '', name = ''] = repo.fullName.split('/');
  const recentStars = await fetchStarsSince(client, owner, name, {
    deadline,
    since: new Date(repo.pushedAt),
    totalStars: repo.stars,
    maxPages: STAR_PAGES,
  });
  const updated = { ...signals, recentStars };
  await store(repo.fullName, updated, now);
  return updated;
}

export type UnfinishedReading = { score: number; readme: number; unanswered: number | null; commits: number | null };

/**
 * The adjusted unfinished score of a repository from its signals (CLAUDE.md §8 F7 steps 5–6), with
 * the parts behind it. Open issues nobody answered stand in for "no comment from the owner".
 */
export function unfinishedFromSignals(signals: RepoSignals, unfinishedTerms: RegExp | null): UnfinishedReading {
  const openIssues = signals.issues.openComments;
  const readme = readmeUnfinishedSignal(signals.readme, unfinishedTerms);
  const unanswered = openIssues.length === 0 ? null : openIssues.filter((comments) => comments === 0).length / openIssues.length;
  const commits = commitUnfinishedSignal(signals.commitMessages, unfinishedTerms);
  const noReleases = signals.hasReleases ? 0 : 1;
  const score = adjustedUnfinished(unfinishedScore([readme, unanswered, commits, noReleases]), {
    hasReleases: signals.hasReleases,
    allIssuesClosed: signals.issues.allClosed,
    totalIssues: signals.issues.total,
    readme: signals.readme,
  });
  return { score, readme, unanswered, commits };
}
