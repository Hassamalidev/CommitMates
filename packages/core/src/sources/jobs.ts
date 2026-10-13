import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { linguistSource, runSourceSync } from '@commitmates/sources';
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
