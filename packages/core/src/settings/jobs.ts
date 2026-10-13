import { recomputeSettings } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const payloadSchema = z.object({});

/** Nightly: recompute every settings key that has a registered function (CLAUDE.md §5.5). */
export const recomputeSettingsJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'recompute_settings',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const report = await recomputeSettings();
    for (const failure of report.failed) {
      ctx.log.error({ key: failure.key, err: failure.error }, 'settings recompute failed for a key');
    }
    ctx.log.info(
      { updated: report.updated.length, empty: report.empty.length, failed: report.failed.length },
      'settings recomputed',
    );
    return {
      kind: 'done',
      resultRef: { updated: report.updated, empty: report.empty, failed: report.failed.map((failure) => failure.key) },
    };
  },
};
