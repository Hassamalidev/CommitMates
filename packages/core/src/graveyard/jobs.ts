import { createHash } from 'node:crypto';

import { monthsBetween, scoreRevivals, termMatcher } from '@commitmates/algorithms';
import { getCategoryNumber, getSetting } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor, searchRepositories, type SearchRepo } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';

import { computeExpansion } from '../taxonomy/service';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import {
  graveyardInputSchema,
  graveyardPayloadSchema,
  graveyardResultSchema,
  type GraveyardInput,
  type GraveyardItem,
  type GraveyardPayload,
} from './schemas';
import { repoSignals, unfinishedFromSignals, withRecentStars, type RepoSignals } from './signals';

/** The steps `graveyard_search` reports, in order. */
export const GRAVEYARD_STEPS = { expanding: 'expanding', searching: 'searching', reading: 'reading', scoring: 'scoring' } as const;

/** Candidates kept from the searches (§8 F7 step 2: "up to 100"). */
const MAX_CANDIDATES = 100;
/** Expansion topics searched besides the term itself (§8 F7 step 2: "up to 3 queries"). */
const EXTRA_QUERIES = 2;
/** Suggestions offered when nothing was found. */
const MAX_SUGGESTIONS = 5;
/** Time kept in hand before the deadline for scoring and storing. */
const DEADLINE_MARGIN_MS = 4000;
/** Characters of a SHA-256 digest used to key a query. */
const QUERY_KEY_LENGTH = 16;
/** Characters of an ISO timestamp that make up `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

const normalizedQuery = (q: string) => q.toLowerCase().trim().replace(/\s+/g, ' ');
const queryKey = (input: GraveyardInput) =>
  `${input.scope}:${createHash('sha256').update(normalizedQuery(input.q)).digest('hex').slice(0, QUERY_KEY_LENGTH)}`;

export const graveyardTool: ToolDefinition<GraveyardInput> = {
  slug: 'graveyard',
  jobType: 'graveyard_search',
  cacheKind: 'graveyard',
  input: graveyardInputSchema,
  subjectKey: (input) => `${input.scope}:${normalizedQuery(input.q)}`,
  idempotencyKey: (input, now) => `graveyard:${queryKey(input)}:${hourBucket(now)}`,
  payload: (input) => ({ q: normalizedQuery(input.q), scope: input.scope }),
  ttlSetting: 'cache.searchTtlHours',
};

/** A date `months` before `now`, as GitHub's `pushed:<` qualifier wants it. */
function cutoffDate(now: Date, months: number): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - Math.floor(months));
  return date.toISOString().slice(0, ISO_DATE_LENGTH);
}

/** Category of a candidate: the expansion's best topic it carries, else the query's slug (§8 F7 step 3). */
const categoryOf = (repo: SearchRepo, topics: readonly string[], fallback: string) => topics.find((topic) => repo.topics.includes(topic)) ?? fallback;

/**
 * Searches for inactive projects worth reviving (CLAUDE.md §8 F7). Each repository's
 * signals are cached, so a search cut short by the deadline continues where it stopped.
 */
export const graveyardSearchJob: JobHandler<GraveyardPayload> = {
  type: 'graveyard_search',
  schema: graveyardPayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const now = ctx.now();
    const outOfTime = () => Date.now() > ctx.deadline - DEADLINE_MARGIN_MS;

    await ctx.progress({ step: GRAVEYARD_STEPS.expanding, message: `Learning what “${payload.q}” covers` });
    const expansion = await computeExpansion(payload.q, { client, now, deadline: ctx.deadline });
    if (expansion.status === 'partial') return { kind: 'continue', payload };
    const topics = expansion.expansion.items.filter((item) => item.kind === 'topic').map((item) => item.value);
    const slug = expansion.expansion.slug;

    const [defaultIdle, minCommits, freshMonths, noLicenseFactor, weights, deepTopN, terms] = await Promise.all([
      getSetting('graveyard.idleMonths.default'),
      getSetting('graveyard.minCommits'),
      getSetting('graveyard.freshMonths'),
      getSetting('graveyard.noLicenseFactor'),
      getSetting('graveyard.weights'),
      getSetting('graveyard.deepScoreTopN'),
      getSetting('graveyard.unfinishedTerms'),
    ]);
    const unfinishedTerms = termMatcher(terms);

    await ctx.progress({ step: GRAVEYARD_STEPS.searching });
    const qualifiers = `fork:false pushed:<${cutoffDate(now, defaultIdle)}`;
    const ownTopic = topics.includes(slug) ? slug : topics[0];
    const queries = [
      `${payload.q} in:name,description,readme ${qualifiers}`,
      ...[ownTopic, ...topics.filter((topic) => topic !== ownTopic)]
        .filter((topic): topic is string => topic !== undefined)
        .slice(0, EXTRA_QUERIES)
        .map((topic) => `topic:${topic} ${qualifiers}`),
    ];
    const candidates = new Map<number, SearchRepo>();
    for (const query of queries) {
      if (candidates.size >= MAX_CANDIDATES) break;
      const { repos } = await searchRepositories(client, query, { perPage: MAX_CANDIDATES, deadline: ctx.deadline });
      for (const repo of repos) if (candidates.size < MAX_CANDIDATES && !candidates.has(repo.githubId)) candidates.set(repo.githubId, repo);
    }
    const ordered = [...candidates.values()];

    await ctx.progress({ step: GRAVEYARD_STEPS.reading, message: `Reading ${ordered.length} projects` });
    const passing: { repo: SearchRepo; signals: RepoSignals; relevance: number; idleMonths: number; category: string }[] = [];
    const idleByCategory = new Map<string, number>();
    for (const [index, repo] of ordered.entries()) {
      if (outOfTime()) return { kind: 'continue', payload };
      if (repo.isFork) continue;
      const category = categoryOf(repo, topics, slug);
      if (!idleByCategory.has(category)) idleByCategory.set(category, (await getCategoryNumber('graveyard.idleMonths', category)) ?? defaultIdle);
      const idleMonths = repo.pushedAt ? monthsBetween(new Date(repo.pushedAt), now) : Number.POSITIVE_INFINITY;
      if (idleMonths < (idleByCategory.get(category) ?? defaultIdle)) continue;
      const signals = await repoSignals(client, repo.fullName, now, ctx.deadline);
      if (!signals.hasReadme || signals.commitEstimate < minCommits) continue;
      passing.push({ repo, signals, relevance: ordered.length <= 1 ? 1 : 1 - index / ordered.length, idleMonths, category });
    }

    // Recent stars cost extra requests: only for the best matches (§8 F7 step 7).
    for (const entry of passing.slice(0, deepTopN)) {
      if (outOfTime()) return { kind: 'continue', payload };
      entry.signals = await withRecentStars(client, entry.repo, entry.signals, now, ctx.deadline);
    }

    await ctx.progress({ step: GRAVEYARD_STEPS.scoring });
    const unfinished = passing.map(({ signals }) => unfinishedFromSignals(signals, unfinishedTerms));
    const scores = scoreRevivals(
      passing.map((entry, index) => ({
        key: entry.repo.fullName,
        stars: entry.repo.stars,
        forks: entry.repo.forks,
        openIssues: entry.repo.openIssues,
        recentStars: entry.signals.recentStars ?? 0,
        unfinished: unfinished[index]?.score ?? 0,
        idleMonths: Number.isFinite(entry.idleMonths) ? entry.idleMonths : freshMonths + 1,
        hasLicense: entry.repo.licenseSpdx !== null,
        sizeKb: entry.repo.sizeKb ?? 0,
        relevance: entry.relevance,
      })),
      { weights, freshMonths, noLicenseFactor },
    );

    const items: GraveyardItem[] = passing
      .map((entry, index) => {
        const score = scores[index];
        const signal = unfinished[index];
        return {
          fullName: entry.repo.fullName,
          description: entry.repo.description,
          stars: entry.repo.stars,
          forks: entry.repo.forks,
          openIssues: entry.repo.openIssues,
          licenseSpdx: entry.repo.licenseSpdx,
          archived: entry.repo.isArchived,
          pushedAt: entry.repo.pushedAt,
          idleMonths: Number.isFinite(entry.idleMonths) ? entry.idleMonths : 0,
          category: entry.category,
          difficulty: score?.difficulty ?? null,
          unfinished: signal?.score ?? 0,
          revivability: score?.revivability ?? 0,
          rank: score?.rank ?? 0,
          signals: {
            readmeUnfinished: signal?.readme === 1,
            unansweredIssues: signal?.unanswered ?? null,
            unfinishedCommits: signal?.commits ?? null,
            noReleases: !entry.signals.hasReleases,
          },
        };
      })
      .sort((a, b) => b.rank - a.rank || a.fullName.localeCompare(b.fullName));

    const result = graveyardResultSchema.parse({
      query: payload.q,
      scope: payload.scope,
      terms: topics,
      items,
      suggestions: items.length === 0 ? topics.filter((topic) => topic !== slug).slice(0, MAX_SUGGESTIONS) : [],
    });
    const resultRef = await storeToolResult(graveyardTool, { q: payload.q, scope: payload.scope }, result, { isMemberSubject: false, now });
    return { kind: 'done', resultRef };
  },
};
