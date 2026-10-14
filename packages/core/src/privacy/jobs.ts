import { purgeNonMemberRaw } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const emptyPayload = z.object({});

/**
 * Hourly: delete expired raw data about people who are not members — cached GitHub
 * profiles and repositories, tool results and API responses (CLAUDE.md §5.12, class C).
 */
export const purgeNonUserRawJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'purge_non_user_raw',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const report = await purgeNonMemberRaw(ctx.now());
    ctx.log.info(report, 'expired non-member data purged');
    return { kind: 'done', resultRef: report };
  },
};
