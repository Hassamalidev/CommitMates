import { createHash } from 'node:crypto';

import { MAINTAINER_ROLES, applyGates, issueRank, medianResponseHours, skillMatch } from '@commitmates/algorithms';
import { getCachedAnalysis, getSetting, putCachedAnalysis, recordMetricSamples } from '@commitmates/db';
import { SERVER_IDENTITY, fetchIssueResponses, fetchLabels, fetchRepository, githubFor, searchIssues, type FoundIssue } from '@commitmates/github';
import { PRIORITY, type JobContext, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { getCachedDevCard, identityFor, readProfile, storeDevCard } from '../persona/jobs';
import { computeExpansion } from '../taxonomy/service';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { ossInputSchema, ossPayloadSchema, ossResultSchema, type OssInput, type OssIssue, type OssPayload } from './schemas';

/** Anonymous per-project response times, for the computed `oss.maxResponseHours`. */
export const OSS_RESPONSE_SAMPLE = 'oss.responseHours';

/** The steps `oss_search` reports, in order. */
export const OSS_STEPS = { profile: 'profile', searching: 'searching', projects: 'projects', ranking: 'ranking' } as const;

/** Languages searched (§8 F8 step 1: "up to 3 languages"). */
const MAX_LANGUAGES = 3;
/** Search pages per query (§8 F8 step 1: "two pages maximum"). */
const MAX_PAGES = 2;
/** Issues per search page. */
const PER_PAGE = 50;
/** Issues shown. */
const MAX_RESULTS = 30;
/** Time kept in hand before the deadline for ranking and storing. */
const DEADLINE_MARGIN_MS = 4000;
const MS_PER_DAY = 86_400_000; // allowed-literal: unit conversion
const MS_PER_HOUR = 3_600_000; // allowed-literal: unit conversion
/** Characters of a SHA-256 digest used to key a request. */
const KEY_LENGTH = 16;
const OTHER_LANGUAGE = 'other';
const REPO_KIND = 'oss_repo';

const sorted = (values: readonly string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim().toLowerCase()))].sort();
const requestKey = (input: OssInput) =>
  createHash('sha256')
    .update(JSON.stringify({ login: input.login?.toLowerCase() ?? null, languages: sorted(input.languages), topics: sorted(input.topics) }))
    .digest('hex')
    .slice(0, KEY_LENGTH);

export const ossTool: ToolDefinition<OssInput> = {
  slug: 'oss',
  jobType: 'oss_search',
  cacheKind: 'oss',
  input: ossInputSchema,
  subjectKey: (input) => (input.login ? `login:${input.login.toLowerCase()}` : `languages:${sorted(input.languages).join(',')}`),
  params: (input) => ({ languages: sorted(input.languages), topics: sorted(input.topics) }),
  idempotencyKey: (input, now) => `oss:${requestKey(input)}:${hourBucket(now)}`,
  payload: (input, context) => ({ ...input, ...(context.userId !== undefined ? { requestedBy: context.userId } : {}) }),
  ttlSetting: 'cache.searchTtlHours',
};

const repoInfoSchema = z.object({
  githubId: z.number(),
  language: z.string().nullable(),
  topics: z.array(z.string()),
  pushedAt: z.string().nullable(),
  labels: z.array(z.string()),
  responseHours: z.number().nullable(),
});
type RepoInfo = z.infer<typeof repoInfoSchema>;

/** A candidate project's language, topics, beginner labels and responsiveness, cached for `cache.searchTtlHours`. */
async function repoInfo(fullName: string, labelTerms: readonly string[], ctx: JobContext): Promise<RepoInfo> {
  const key = { kind: REPO_KIND, subjectKey: fullName.toLowerCase(), paramsHash: 'default' };
  const now = ctx.now();
  const cached = repoInfoSchema.safeParse((await getCachedAnalysis(key, now))?.result);
  if (cached.success) return cached.data;
  const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
  const [owner = '', name = ''] = fullName.split('/');
  const request = { deadline: ctx.deadline };
  const [repository, labels, sample, ttlHours] = [
    await fetchRepository(client, owner, name, request),
    await fetchLabels(client, owner, name, request),
    await fetchIssueResponses(client, owner, name, { ...request, count: await getSetting('oss.responsivenessSample'), maintainerRoles: MAINTAINER_ROLES }),
    await getSetting('cache.searchTtlHours'),
  ];
  const responseHours = medianResponseHours(sample, now);
  // Each project's median feeds the computed `oss.maxResponseHours` (p60), counted once per project.
  if (responseHours !== null) await recordMetricSamples(repository.githubId, { [OSS_RESPONSE_SAMPLE]: responseHours }, now);
  const info: RepoInfo = {
    githubId: repository.githubId,
    language: repository.language,
    topics: repository.topics,
    pushedAt: repository.pushedAt,
    labels: labels.filter((label) => labelTerms.includes(label.toLowerCase())),
    responseHours,
  };
  await putCachedAnalysis({ ...key, result: info, isMemberSubject: false, computedAt: now, expiresAt: new Date(now.getTime() + ttlHours * MS_PER_HOUR) });
  return info;
}

/**
 * Beginner-friendly issues from projects that answer newcomers (CLAUDE.md §8 F8). Project
 * details are cached, so a search cut short by the deadline continues where it stopped.
 */
export const ossSearchJob: JobHandler<OssPayload & { requestedBy?: string | undefined }> = {
  type: 'oss_search',
  schema: ossPayloadSchema.extend({ requestedBy: z.uuid().optional() }),
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    const now = ctx.now();
    const outOfTime = () => Date.now() > ctx.deadline - DEADLINE_MARGIN_MS;
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });

    let languages = (payload.languages ?? []).slice(0, MAX_LANGUAGES);
    let topics = sorted(payload.topics);
    if (payload.login) {
      await ctx.progress({ step: OSS_STEPS.profile, message: `Reading @${payload.login}` });
      const card =
        (await getCachedDevCard(payload.login, now)) ??
        (await storeDevCard(await readProfile(payload.login, { identity: await identityFor(payload.login, payload.requestedBy), ctx }), now)).card;
      if (languages.length === 0) languages = card.languages.filter((language) => language.name !== OTHER_LANGUAGE).slice(0, MAX_LANGUAGES).map((language) => language.name);
      topics = [...new Set([...topics, ...card.tags.map((tag) => tag.tag)])];
    }
    // Picked topics are widened with what usually goes with them (CLAUDE.md §8 F6).
    for (const topic of sorted(payload.topics)) {
      const expansion = await computeExpansion(topic, { client, now, deadline: ctx.deadline });
      if (expansion.status === 'partial') return { kind: 'continue', payload };
      for (const item of expansion.expansion.items) if (item.kind === 'topic' && !topics.includes(item.value)) topics.push(item.value);
    }

    const [labelTerms, maxRepoIdleDays, maxResponseHours, maxComments] = await Promise.all([
      getSetting('oss.beginnerLabelTerms'),
      getSetting('oss.maxRepoIdleDays'),
      getSetting('oss.maxResponseHours'),
      getSetting('oss.maxComments'),
    ]);
    const terms = labelTerms.map((term) => term.toLowerCase());

    await ctx.progress({ step: OSS_STEPS.searching });
    const labelQualifier = `label:${terms.map((term) => `"${term}"`).join(',')}`;
    const found = new Map<string, FoundIssue>();
    for (const language of languages) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const query = `is:issue is:open no:assignee archived:false -linked:pr language:"${language}" ${labelQualifier}`;
        const { issues } = await searchIssues(client, query, { perPage: PER_PAGE, page, deadline: ctx.deadline });
        for (const issue of issues) found.set(issue.url, issue);
        if (issues.length < PER_PAGE) break;
      }
    }

    await ctx.progress({ step: OSS_STEPS.projects });
    const repos = new Map<string, RepoInfo>();
    for (const repo of new Set([...found.values()].map((issue) => issue.repo))) {
      if (outOfTime()) return { kind: 'continue', payload };
      repos.set(repo, await repoInfo(repo, terms, ctx));
    }

    await ctx.progress({ step: OSS_STEPS.ranking });
    const recentSince = now.getTime() - maxRepoIdleDays * MS_PER_DAY;
    const candidates: OssIssue[] = [...found.values()].flatMap((issue) => {
      const repo = repos.get(issue.repo);
      const pushedAt = repo?.pushedAt ?? null;
      if (!repo || pushedAt === null || new Date(pushedAt).getTime() < recentSince) return [];
      const ageDays = Math.max(0, (now.getTime() - new Date(issue.createdAt).getTime()) / MS_PER_DAY);
      const match = skillMatch({ language: repo.language, topics: repo.topics }, { languages, topics });
      return [
        {
          repo: issue.repo,
          number: issue.number,
          title: issue.title,
          url: issue.url,
          labels: issue.labels.filter((label) => terms.includes(label.toLowerCase())),
          comments: issue.comments,
          ageDays,
          responseHours: repo.responseHours,
          skillMatch: match,
          rank: issueRank({ skillMatch: match, ageDays, responseHours: repo.responseHours, maxResponseHours }),
        },
      ];
    });
    const { kept, relaxed } = applyGates(candidates, { maxComments, maxResponseHours });
    const result = ossResultSchema.parse({
      languages,
      topics,
      relaxed,
      issues: kept.sort((a, b) => b.rank - a.rank || a.url.localeCompare(b.url)).slice(0, MAX_RESULTS),
    });
    const input = { ...(payload.login ? { login: payload.login } : {}), languages: payload.languages, topics: payload.topics };
    const resultRef = await storeToolResult(ossTool, input as OssInput, result, { isMemberSubject: false, now });
    return { kind: 'done', resultRef };
  },
};
