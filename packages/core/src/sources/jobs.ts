import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { exploreSource, linguistSource, runSourceSync } from '@commitmates/sources';
import { z } from 'zod';

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
