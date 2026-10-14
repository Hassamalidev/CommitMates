import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { resolvePendingLocations } from '@commitmates/sources';
import { z } from 'zod';

const emptyPayload = z.object({});

/**
 * Every minute: resolve queued location strings one at a time through the paced geocoder
 * (CLAUDE.md §6.8, §8 F18 "Geocoding"). The app-wide interval is enforced inside
 * `resolvePendingLocations`, so overlapping runs cannot speed it up.
 */
export const geocodePendingJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'geocode_pending',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const report = await resolvePendingLocations({ deadline: ctx.deadline, now: ctx.now });
    ctx.log.info(report, 'pending locations geocoded');
    return { kind: 'done', resultRef: report };
  },
};
