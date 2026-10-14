import { teamMetrics } from '@commitmates/algorithms';
import { ValidationError, getDb, getSetting, schema } from '@commitmates/db';
import {
  SERVER_IDENTITY,
  fetchCommitFiles,
  fetchContributorStats,
  fetchFileText,
  fetchRepository,
  fetchTree,
  githubFor,
  listCommits,
  parseGitHubUrl,
} from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { createPathMatcher } from '@commitmates/sources';

import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { linguistExclusionPatterns } from './attributes';
import {
  fairnessInputSchema,
  fairnessPayloadSchema,
  fairnessResultSchema,
  type FairnessInput,
  type FairnessPayload,
} from './schemas';
import { assembleContributors, coAuthors, commitAuthorKey } from './service';

/** The steps `fairness_report` reports, in order. */
export const FAIRNESS_STEPS = { repo: 'repo', stats: 'stats', commits: 'commits', lines: 'lines', building: 'building' } as const;

/** How long to wait while GitHub computes the statistics (it answers 202 meanwhile). */
const STATS_WAIT_MS = 30_000;
/** Time kept in hand before the deadline for storing what was read. */
const DEADLINE_MARGIN_MS = 5000;
/** Progress is reported in percent. */
const PERCENT = 100;
/** Distinct file paths remembered across continuations before files stop being counted. */
const MAX_TRACKED_PATHS = 5000;

const refOf = (input: FairnessInput) => {
  const ref = parseGitHubUrl(input.repoUrl);
  if (!ref) throw new ValidationError('fairness.invalid_url', 'That does not look like a GitHub repository link.', { field: 'repoUrl' });
  return ref;
};
const repoKey = (input: FairnessInput) => {
  const ref = parseGitHubUrl(input.repoUrl);
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : input.repoUrl.toLowerCase();
};

export const fairnessTool: ToolDefinition<FairnessInput> = {
  slug: 'fairness',
  jobType: 'fairness_report',
  cacheKind: 'fairness',
  input: fairnessInputSchema,
  subjectKey: repoKey,
  idempotencyKey: (input, now) => `fairness:${repoKey(input)}:${hourBucket(now)}`,
  ttlSetting: 'cache.fairnessTtlHours',
};

/**
 * Who contributed how much code to a team repository (CLAUDE.md §8 F4). Per-commit detail
 * is read only where it changes the answer (excluded paths, people without an account,
 * co-authors) and continues across runs when there is a lot of it.
 */
export const fairnessReportJob: JobHandler<FairnessPayload> = {
  type: 'fairness_report',
  schema: fairnessPayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    const { owner, repo } = refOf(payload);
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const request = { deadline: ctx.deadline };

    await ctx.progress({ step: FAIRNESS_STEPS.repo, message: `Opening ${owner}/${repo}` });
    const repository = await fetchRepository(client, owner, repo, request);
    if (repository.isPrivate) {
      throw new ValidationError('fairness.private', 'That repository is private. Fairness reports work on public repositories.', { field: 'repoUrl' });
    }
    if (repository.isFork && repository.parent && repository.parent.sizeKb > repository.sizeKb) {
      throw new ValidationError('fairness.fork', `This is a fork of ${repository.parent.fullName}. Check the team's own repository instead.`, {
        field: 'repoUrl',
      });
    }

    await ctx.progress({ step: FAIRNESS_STEPS.stats });
    const stats = await fetchContributorStats(client, owner, repo, request);
    if (stats.pending) return { kind: 'wait', until: new Date(ctx.now().getTime() + STATS_WAIT_MS), reason: 'dependency' };

    await ctx.progress({ step: FAIRNESS_STEPS.commits });
    const maxCommits = await getSetting('fairness.maxCommits');
    const { commits } = await listCommits(client, owner, repo, { ...request, limit: maxCommits });

    const [tree, gitattributes, patterns] = await Promise.all([
      fetchTree(client, owner, repo, repository.defaultBranch, request),
      fetchFileText(client, owner, repo, '.gitattributes', request),
      getDb()
        .select({ kind: schema.pathPatterns.kind, pattern: schema.pathPatterns.pattern, compiledOk: schema.pathPatterns.compiledOk })
        .from(schema.pathPatterns),
    ]);
    const linguist = createPathMatcher(patterns);
    const attributes = linguistExclusionPatterns(gitattributes ?? '');
    const isExcluded = (path: string) => linguist.isVendored(path) || linguist.isDocumentation(path) || attributes.some((pattern) => pattern.test(path));
    const excludedPaths = tree.entries.filter((entry) => entry.type === 'blob' && isExcluded(entry.path)).length;

    // Per-commit lines are needed for every commit when paths are excluded or there are no statistics;
    // otherwise only where statistics cannot answer: people without an account, and co-authored commits.
    const fromStats = stats.contributors.length > 0;
    const needAll = excludedPaths > 0 || !fromStats;
    const toRead = commits.filter((commit) => !commit.isMerge && (needAll || commit.account === null || coAuthors(commit.message).length > 0));

    const lines = new Map(Object.entries(payload.lines ?? {}));
    const excluded = new Map(Object.entries(payload.excluded ?? {}));
    let files: Map<string, Set<string>> | null =
      payload.files === null ? null : new Map(Object.entries(payload.files ?? {}).map(([key, paths]) => [key, new Set(paths)]));
    let cursor = payload.cursor ?? 0;
    if (cursor < toRead.length) await ctx.progress({ step: FAIRNESS_STEPS.lines, pct: Math.round((cursor / toRead.length) * PERCENT) });

    for (; cursor < toRead.length; cursor += 1) {
      if (Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) {
        const state = {
          ...payload,
          cursor,
          lines: Object.fromEntries(lines),
          excluded: Object.fromEntries(excluded),
          files: files === null ? null : Object.fromEntries([...files].map(([key, paths]) => [key, [...paths]])),
        };
        return { kind: 'continue', payload: state };
      }
      const commit = toRead[cursor];
      if (!commit) continue;
      const key = commitAuthorKey(commit);
      let net: [number, number] = [0, 0];
      for (const file of await fetchCommitFiles(client, owner, repo, commit.sha, request)) {
        if (isExcluded(file.path)) {
          if (key !== null) {
            const [additions, deletions] = excluded.get(key) ?? [0, 0];
            excluded.set(key, [additions + file.additions, deletions + file.deletions]);
          }
          continue;
        }
        net = [net[0] + file.additions, net[1] + file.deletions];
        if (files && key !== null) files.set(key, (files.get(key) ?? new Set()).add(file.path));
      }
      lines.set(commit.sha, net);
      if (files && [...files.values()].reduce((total, paths) => total + paths.size, 0) > MAX_TRACKED_PATHS) files = null;
    }

    await ctx.progress({ step: FAIRNESS_STEPS.building });
    // Files are counted only when every commit was read in detail.
    const assembled = assembleContributors({
      stats: fromStats ? stats.contributors : null,
      commits,
      reading: { lines, excluded, files: needAll ? files : null },
    });
    const result = fairnessResultSchema.parse({
      repo: { fullName: repository.fullName, githubId: repository.githubId },
      mode: fromStats ? 'stats' : 'commits',
      weeks: assembled.weeks,
      contributors: assembled.contributors,
      commitsAnalyzed: commits.length,
      excludedPaths,
      excludedLines: [...excluded.values()].reduce((total, [additions, deletions]) => total + additions + deletions, 0),
      coAuthorCredits: assembled.coAuthorCredits,
    });

    // Team numbers only, for the weekly usage metric; nobody is named.
    const metrics = teamMetrics(result.contributors, {
      metric: 'commits',
      includeBots: false,
      leastShareThreshold: await getSetting('fairness.leastShareThreshold'),
    });
    await getDb()
      .insert(schema.fairnessReports)
      .values({
        repoGithubId: repository.githubId,
        params: { mode: result.mode },
        result: { people: metrics.people.length, gini: metrics.gini, leastShareRatio: metrics.leastShareRatio, flagged: metrics.flagged },
        computedAt: ctx.now(),
      });

    const resultRef = await storeToolResult(fairnessTool, { repoUrl: payload.repoUrl }, result, { isMemberSubject: false, now: ctx.now() });
    return { kind: 'done', resultRef };
  },
};
