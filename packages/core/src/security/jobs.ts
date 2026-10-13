import { deleteStaleBuckets, rotateSalts } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const emptyPayload = z.object({});
type EmptyPayload = z.infer<typeof emptyPayload>;

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

/** Daily: delete rate-limit buckets untouched for a day (CLAUDE.md §5.10). */
export const cleanupRateBucketsJob: JobHandler<EmptyPayload> = {
  type: 'cleanup_rate_buckets',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const deleted = await deleteStaleBuckets(ctx.now(), MS_PER_DAY);
    ctx.log.info({ deleted }, 'stale rate-limit buckets deleted');
    return { kind: 'done', resultRef: { deleted } };
  },
};

/** Daily: create today's salts and delete expired ones so old hashes cannot be linked (CLAUDE.md §5.12). */
export const rotateSaltsJob: JobHandler<EmptyPayload> = {
  type: 'rotate_salts',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const result = await rotateSalts(ctx.now());
    ctx.log.info(result, 'salts rotated');
    return { kind: 'done', resultRef: result };
  },
};
