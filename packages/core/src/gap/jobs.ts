import { facetPrevalence, findGaps, sharedFacets, type FacetPrevalence } from '@commitmates/algorithms';
import { ValidationError, getSetting, insertGapReport, topicNames, type TopicNames } from '@commitmates/db';
import { SERVER_IDENTITY, fetchRepository, githubFor, parseGitHubUrl, searchRepositories } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';

import { computeExpansion } from '../taxonomy/service';
import { dayBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { allFacets, readRepoFacets, type FacetRepo, type RepoFacets } from './facets';
import { gapInputSchema, gapPayloadSchema, gapResultSchema, type GapFacet, type GapInput, type GapPayload } from './schemas';

/** The steps `gap_analysis` reports, in order. */
export const GAP_STEPS = { repo: 'repo', peers: 'peers', reading: 'reading', comparing: 'comparing' } as const;

/** Topics of the repository searched for peers. */
const SEARCH_TOPICS = 3;
/** Dependency tags searched for peers (§8 F5 step 2: "top 3 dependency tags"). */
const SEARCH_TAGS = 3;
/** Search results asked for per peer slot, since forks and the repository itself are dropped. */
const SEARCH_OVERFETCH = 2;
/** Example peers shown per gap. */
const EXAMPLES = 3;
/** Fewer peers than this share of `gap.peerSampleSize` makes the result low-confidence (§8 F5 "Edge cases"). */
const LOW_CONFIDENCE_SHARE = 1 / 3;
/** Peers must have been pushed within this many months (§8 F5 step 2: "pushed within the last year"). */
const PEER_RECENT_MONTHS = 12;
/** Time kept in hand before the deadline for comparing and storing. */
const DEADLINE_MARGIN_MS = 4000;
/** Characters of an ISO timestamp that make up `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;
/** GitHub's largest search page. */
const SEARCH_PAGE = 100;

const refOf = (input: GapInput) => {
  const ref = parseGitHubUrl(input.repoUrl);
  if (!ref) throw new ValidationError('gap.invalid_url', 'That does not look like a GitHub repository link.', { field: 'repoUrl' });
  return ref;
};
const repoKey = (input: GapInput) => {
  const ref = parseGitHubUrl(input.repoUrl);
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : input.repoUrl.toLowerCase();
};

export const gapTool: ToolDefinition<GapInput> = {
  slug: 'gap',
  jobType: 'gap_analysis',
  cacheKind: 'gap',
  input: gapInputSchema,
  subjectKey: repoKey,
  idempotencyKey: (input, now) => `gap:${repoKey(input)}:${dayBucket(now)}`,
  ttlSetting: 'cache.gapTtlHours',
};

/** A label for a facet (§8 F5 step 6): the path or tag itself, and the topic it matches when there is one. */
export function describeFacet(entry: FacetPrevalence, names: TopicNames): GapFacet {
  const [prefix = '', ...rest] = entry.facet.split(':');
  const name = rest.join(':');
  const kind = prefix === 'tag' ? 'tag' : prefix === 'meta' ? 'meta' : 'path';
  // "file:dockerfile" and "dir:docker" both point at the topic "docker"; extensions are ignored.
  const stem = name.replace(/^\./, '').replace(/\.[a-z0-9]+$/i, '');
  const slug = kind === 'meta' ? undefined : (names.aliasToSlug.get(kind === 'tag' ? name : stem) ?? names.aliasToSlug.get(name));
  return { facet: entry.facet, kind, name, topic: slug === undefined ? null : (names.displayNames.get(slug) ?? slug), prevalence: entry.prevalence, peersWith: entry.peersWith };
}

/**
 * What a repository lacks compared with similar successful ones (CLAUDE.md §8 F5). Peer
 * facets are cached per repository, so a run cut short continues where it stopped.
 */
export const gapAnalysisJob: JobHandler<GapPayload> = {
  type: 'gap_analysis',
  schema: gapPayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    const { owner, repo: name } = refOf(payload);
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const now = ctx.now();
    const outOfTime = () => Date.now() > ctx.deadline - DEADLINE_MARGIN_MS;

    await ctx.progress({ step: GAP_STEPS.repo, message: `Reading ${owner}/${name}` });
    const repository = await fetchRepository(client, owner, name, { deadline: ctx.deadline });
    if (repository.isPrivate) {
      throw new ValidationError('gap.private', 'That repository is private. The Gap Finder works on public repositories.', { field: 'repoUrl' });
    }
    const own = await readRepoFacets(client, repository, now, ctx.deadline);
    if (own.paths.length === 0) throw new ValidationError('gap.empty', 'That repository is empty, so there is nothing to compare yet.', { field: 'repoUrl' });

    const [peerSampleSize, minPrevalence, maxGaps, minPeerStars] = await Promise.all([
      getSetting('gap.peerSampleSize'),
      getSetting('gap.minPrevalence'),
      getSetting('gap.maxGaps'),
      getSetting('gap.minPeerStars'),
    ]);

    await ctx.progress({ step: GAP_STEPS.peers });
    // Topics to search: the repository's own, widened with the taxonomy of the first one, then its dependency tags.
    const searchTopics = repository.topics.slice(0, SEARCH_TOPICS);
    const firstTopic = searchTopics[0];
    if (firstTopic) {
      const expansion = await computeExpansion(firstTopic, { client, now, deadline: ctx.deadline });
      if (expansion.status === 'partial') return { kind: 'continue', payload };
      for (const item of expansion.expansion.items) if (item.kind === 'topic' && !searchTopics.includes(item.value)) searchTopics.push(item.value);
    }
    const pushedSince = new Date(now);
    pushedSince.setUTCMonth(pushedSince.getUTCMonth() - PEER_RECENT_MONTHS);
    const qualifiers = [
      `stars:>=${minPeerStars}`,
      `pushed:>=${pushedSince.toISOString().slice(0, ISO_DATE_LENGTH)}`,
      'fork:false',
      ...(repository.language ? [`language:"${repository.language}"`] : []),
    ].join(' ');
    const queries = [
      ...searchTopics.slice(0, SEARCH_TOPICS + SEARCH_TAGS).map((topic) => `topic:${topic} ${qualifiers}`),
      ...own.tags.slice(0, SEARCH_TAGS).map((tag) => `topic:${tag} ${qualifiers}`),
      // A repository without topics or tags is compared by its name and language.
      ...(searchTopics.length === 0 && own.tags.length === 0 ? [`${repository.name.replace(/[-_]+/g, ' ')} in:name,description ${qualifiers}`] : []),
    ];
    const peers = new Map<number, FacetRepo>();
    for (const query of queries) {
      if (peers.size >= peerSampleSize) break;
      const { repos } = await searchRepositories(client, query, { perPage: Math.min(SEARCH_PAGE, peerSampleSize * SEARCH_OVERFETCH), deadline: ctx.deadline });
      for (const peer of repos) {
        const isSelf = peer.githubId === repository.githubId || peer.fullName.toLowerCase() === repository.fullName.toLowerCase();
        if (peers.size >= peerSampleSize || isSelf || peer.isFork || peers.has(peer.githubId)) continue;
        peers.set(peer.githubId, peer);
      }
    }

    await ctx.progress({ step: GAP_STEPS.reading, message: `Reading ${peers.size} similar repositories` });
    const peerFacets: { repo: FacetRepo; facets: RepoFacets }[] = [];
    for (const peer of peers.values()) {
      if (outOfTime()) return { kind: 'continue', payload };
      peerFacets.push({ repo: peer, facets: await readRepoFacets(client, peer, now, ctx.deadline) });
    }

    await ctx.progress({ step: GAP_STEPS.comparing });
    const prevalence = facetPrevalence(peerFacets.map((entry) => allFacets(entry.facets)));
    const ownSet = new Set(allFacets(own));
    const names = await topicNames();
    const byStars = [...peerFacets].sort((a, b) => b.repo.stars - a.repo.stars);
    const gaps = findGaps(ownSet, prevalence, { minPrevalence, maxGaps }).map((entry) => ({
      ...describeFacet(entry, names),
      examples: byStars.filter((peer) => allFacets(peer.facets).includes(entry.facet)).slice(0, EXAMPLES).map((peer) => peer.repo.fullName),
    }));
    const result = gapResultSchema.parse({
      repo: { fullName: repository.fullName, githubId: repository.githubId },
      peers: byStars.map((peer) => ({ fullName: peer.repo.fullName, stars: peer.repo.stars })),
      gaps,
      shared: sharedFacets(ownSet, prevalence, minPrevalence).map((entry) => describeFacet(entry, names)),
      lowConfidence: peerFacets.length < peerSampleSize * LOW_CONFIDENCE_SHARE,
    });

    await insertGapReport({
      repoGithubId: repository.githubId,
      peerRepoIds: byStars.map((peer) => peer.repo.githubId),
      facets: allFacets(own),
      gaps: result.gaps.map((gap) => ({ facet: gap.facet, prevalence: gap.prevalence })),
      computedAt: now,
    });
    const resultRef = await storeToolResult(gapTool, { repoUrl: payload.repoUrl }, result, { isMemberSubject: false, now });
    return { kind: 'done', resultRef };
  },
};
