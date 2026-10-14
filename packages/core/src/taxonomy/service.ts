import {
  ALIAS_SCORE,
  RELATED_SCORE,
  mergeExpansion,
  normalizeTerm,
  sampleFrequencies,
  scoreCandidates,
  type ExpansionItem,
} from '@commitmates/algorithms';
import {
  ValidationError,
  dependencyUsage,
  findTopic,
  getExpansion,
  getRepoDependencies,
  getSetting,
  getTopicCounts,
  putExpansion,
  putTopicCount,
  upsertGhRepos,
} from '@commitmates/db';
import { countTopicRepositories, searchRepositories, type GitHubClient, type SearchRepo } from '@commitmates/github';

import { ingestRepoManifests } from '../profiles/ingest';

const MS_PER_HOUR = 3_600_000; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * MS_PER_HOUR; // allowed-literal: unit conversion
/** Sampled repositories whose manifests are read for dependencies (§8 F6 step 4). */
export const DEPENDENCY_SAMPLE = 30;
/** GitHub's largest search page. */
const SEARCH_PAGE = 100;
/** Time kept in hand before the deadline for scoring and storing. */
const DEADLINE_MARGIN_MS = 3000;

export type Expansion = { term: string; slug: string; items: ExpansionItem[]; sampleSize: number; computedAt: string };

export type ExpansionRun = { status: 'done'; expansion: Expansion } | { status: 'partial' };

const toExpansion = (row: { term: string; slug: string; items: ExpansionItem[]; sampleSize: number; computedAt: Date }): Expansion => ({
  ...row,
  computedAt: row.computedAt.toISOString(),
});

/** A cached expansion of a term, or `null` (CLAUDE.md §8 F6 "API"). */
export async function getCachedExpansion(rawTerm: string, now: Date = new Date()): Promise<Expansion | null> {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized) return null;
  const cached = await getExpansion(normalized.term, now);
  return cached ? toExpansion(cached) : null;
}

/** The term's own topic, its aliases and its related topics, from github/explore (§8 F6 step 2). */
async function aliasSeeds(slug: string): Promise<ExpansionItem[]> {
  const topic = await findTopic(slug);
  if (!topic) return [];
  return [
    { kind: 'topic', value: topic.slug, score: ALIAS_SCORE, source: 'alias' },
    ...topic.aliases.map((alias) => ({ kind: 'topic' as const, value: alias, score: ALIAS_SCORE, source: 'alias' as const })),
    ...topic.related.map((related) => ({ kind: 'topic' as const, value: related, score: RELATED_SCORE, source: 'related' as const })),
  ];
}

async function sampleRepos(client: GitHubClient, term: string, topicSlug: string | null, size: number, deadline: number): Promise<SearchRepo[]> {
  const queries = [`${term} in:name,description,readme`, ...(topicSlug ? [`topic:${topicSlug}`] : [])];
  const seen = new Map<number, SearchRepo>();
  for (const query of queries) {
    if (seen.size >= size) break;
    const { repos } = await searchRepositories(client, query, { perPage: Math.min(SEARCH_PAGE, size), deadline });
    for (const repo of repos) if (seen.size < size && !seen.has(repo.githubId)) seen.set(repo.githubId, repo);
  }
  return [...seen.values()];
}

/**
 * Learns which topics and dependencies belong to a term (CLAUDE.md §8 F6). Topic counts and
 * manifests read along the way are stored, so a run cut short by the deadline returns
 * `partial` and the next run picks up where it stopped.
 */
export async function computeExpansion(
  rawTerm: string,
  context: { client: GitHubClient; now: Date; deadline: number },
): Promise<ExpansionRun> {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized) throw new ValidationError('taxonomy.term_too_short', 'Search for at least two characters.', { field: 'q' });
  const cached = await getExpansion(normalized.term, context.now);
  if (cached) return { status: 'done', expansion: toExpansion(cached) };

  const { term, slug } = normalized;
  const outOfTime = () => Date.now() > context.deadline - DEADLINE_MARGIN_MS;
  const [sampleSize, minSampleFreq, maxExpansions, minCorpus, ttlDays, countTtlDays, nonUserTtlHours] = await Promise.all([
    getSetting('taxonomy.sampleSize'),
    getSetting('taxonomy.minSampleFreq'),
    getSetting('taxonomy.maxExpansions'),
    getSetting('taxonomy.minCorpus'),
    getSetting('cache.taxonomyTtlDays'),
    getSetting('cache.topicCountTtlDays'),
    getSetting('privacy.nonUserRawTtlHours'),
  ]);

  const seeds = await aliasSeeds(slug);
  const topicSlug = seeds.find((item) => item.source === 'alias')?.value ?? null;
  const sample = await sampleRepos(context.client, term, topicSlug, sampleSize, context.deadline);

  // Dependencies of the best-matching repositories; manifests are stored and reused across terms.
  const top = sample.slice(0, DEPENDENCY_SAMPLE);
  await upsertGhRepos(
    top.map((repo) => ({
      githubId: repo.githubId,
      ownerGithubId: repo.ownerGithubId,
      fullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      homepage: repo.homepage,
      topics: repo.topics,
      primaryLanguage: repo.language,
      languages: {},
      stars: repo.stars,
      forks: repo.forks,
      openIssues: repo.openIssues,
      licenseSpdx: repo.licenseSpdx,
      isFork: repo.isFork,
      isArchived: repo.isArchived,
      defaultBranch: repo.defaultBranch,
      sizeKb: repo.sizeKb,
      ghCreatedAt: new Date(repo.createdAt),
      pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
      fetchedAt: context.now,
      // Repository metadata found by search follows the short lifetime of data about non-members.
      expiresAt: new Date(context.now.getTime() + nonUserTtlHours * MS_PER_HOUR),
    })),
  );
  const known = new Set((await getRepoDependencies(top.map((repo) => repo.githubId))).map((row) => row.repoGithubId));
  for (const repo of top) {
    if (known.has(repo.githubId)) continue;
    if (outOfTime()) return { status: 'partial' };
    await ingestRepoManifests(context.client, repo, context.now, context.deadline);
  }
  const dependencyRows = await getRepoDependencies(top.map((repo) => repo.githubId));
  const dependenciesByRepo = new Map<number, string[]>();
  for (const row of dependencyRows) dependenciesByRepo.set(row.repoGithubId, [...(dependenciesByRepo.get(row.repoGithubId) ?? []), row.packageName]);

  const topicFreq = sampleFrequencies(sample.map((repo) => repo.topics));
  const dependencyFreq = sampleFrequencies(top.map((repo) => dependenciesByRepo.get(repo.githubId) ?? []));
  const frequentTopics = [...topicFreq].filter(([, freq]) => freq >= minSampleFreq).map(([value]) => value);

  // How common each topic is on all of GitHub, fetched lazily and cached for a week.
  const freshAfter = new Date(context.now.getTime() - countTtlDays * MS_PER_DAY);
  const counts = await getTopicCounts(frequentTopics, freshAfter);
  for (const value of frequentTopics) {
    if (counts.has(value)) continue;
    if (outOfTime()) return { status: 'partial' };
    const total = await countTopicRepositories(context.client, value, { deadline: context.deadline });
    await putTopicCount(value, total, context.now);
    counts.set(value, total);
  }
  const usage = await dependencyUsage([...dependencyFreq.keys()]);
  const useCorpus = usage.corpus >= minCorpus;

  const learned = scoreCandidates(
    [
      ...[...topicFreq].map(([value, sampleFreq]) => ({ kind: 'topic' as const, value, sampleFreq, globalCount: counts.get(value) ?? null })),
      ...[...dependencyFreq].map(([value, sampleFreq]) => ({
        kind: 'dependency' as const,
        value,
        sampleFreq,
        globalCount: useCorpus ? (usage.counts.get(value) ?? null) : null,
      })),
    ],
    { minSampleFreq, maxExpansions },
  );
  const expansion = { term, slug, items: mergeExpansion(seeds, learned), sampleSize: sample.length, computedAt: context.now };
  await putExpansion({ ...expansion, expiresAt: new Date(context.now.getTime() + ttlDays * MS_PER_DAY) });
  return { status: 'done', expansion: toExpansion(expansion) };
}
