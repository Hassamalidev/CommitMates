import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import {
  enrichPackage,
  exploreSource,
  gitleaksSource,
  stopwordsSource,
  findStalePackages,
  linguistSource,
  runSourceSync,
  type PackageRef,
} from '@commitmates/sources';
import { z } from 'zod';

/** Characters of an ISO timestamp that make up `YYYY-MM`. */
const ISO_MONTH_LENGTH = 7;

const emptyPayload = z.object({});
type EmptyPayload = z.infer<typeof emptyPayload>;

/** Weekly: refresh language colors, extensions and path rules from GitHub Linguist (CLAUDE.md §6.3). */
export const syncLinguistJob: JobHandler<EmptyPayload> = {
  type: 'sync_linguist',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const result = await runSourceSync(linguistSource, { now: ctx.now });
    return { kind: 'done', resultRef: result };
  },
};

/** Weekly: refresh the stopword lists YAKE and BM25 use (CLAUDE.md §8 F9 step 1). */
export const syncStopwordsJob: JobHandler<EmptyPayload> = {
  type: 'sync_stopwords',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const result = await runSourceSync(stopwordsSource, { now: ctx.now });
    return { kind: 'done', resultRef: result };
  },
};

/** Weekly: refresh gitleaks' default secret-detection rules (CLAUDE.md §6.7). */
export const syncGitleaksJob: JobHandler<EmptyPayload> = {
  type: 'sync_gitleaks',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const result = await runSourceSync(gitleaksSource, { now: ctx.now });
    return { kind: 'done', resultRef: result };
  },
};

/**
 * Weekly: refresh topic names, aliases and related topics from github/explore
 * (CLAUDE.md §6.2). The first sync fetches about a thousand small files, so it runs in
 * batches and continues in follow-up jobs.
 */
export const syncExploreJob: JobHandler<EmptyPayload> = {
  type: 'sync_explore',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const result = await runSourceSync(exploreSource, { now: ctx.now, deadline: ctx.deadline });
    if (result.status === 'synced' && result.more) {
      await ctx.progress({ step: 'syncing topics', message: `${result.inserted + result.updated} topics in this batch` });
      return { kind: 'continue', payload: {} };
    }
    return { kind: 'done', resultRef: result };
  },
};

// allowed-literal: schema enum of the ecosystems the manifest parsers produce
const ECOSYSTEMS = ['npm', 'pypi', 'crates', 'pub', 'packagist', 'go', 'maven', 'rubygems'] as const;

const enrichPayload = z.object({ ecosystem: z.enum(ECOSYSTEMS), name: z.string().min(1) });
type EnrichPayload = z.infer<typeof enrichPayload>;

/**
 * Fetches one package's registry metadata and derives its tags (CLAUDE.md §6.6).
 * Registry calls are paced app-wide; when the pause would outlast the tick, the pacer
 * raises a rate limit and the runner brings the job back at the right time.
 */
export const enrichPackagesJob: JobHandler<EnrichPayload> = {
  type: 'enrich_packages',
  schema: enrichPayload,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const result = await enrichPackage(payload.ecosystem, payload.name, { now: ctx.now, deadline: ctx.deadline });
    return { kind: 'done', resultRef: { status: result.status, tags: result.derivedTags.length } };
  },
};

/**
 * Queues enrichment for every package without fresh metadata. One job per package and
 * month: a package many repositories share is fetched once.
 */
export async function requestEnrichment(packages: readonly PackageRef[], now: Date = new Date()): Promise<number> {
  const stale = await findStalePackages(packages, now);
  const month = now.toISOString().slice(0, ISO_MONTH_LENGTH);
  for (const { ecosystem, name } of stale) {
    await enqueue('enrich_packages', { ecosystem, name }, { idempotencyKey: `pkg:${ecosystem}:${name}:${month}` });
  }
  return stale.length;
}
