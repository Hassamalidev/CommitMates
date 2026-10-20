import { trustComponents, trustMultiplier, trustScore } from '@commitmates/algorithms';
import { getSetting, saveTrustScores, trustInputs } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

const payloadSchema = z.object({});

/**
 * Nightly trust scores (CLAUDE.md §8 F12 "Trust score"): account age, verification, the accept rate
 * of message requests, and distinct verified reporters, weighted and mapped onto the multiplier that
 * scales each member's daily request limit.
 */
export const computeTrustJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'compute_trust',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const now = ctx.now();
    const [weights, range, ageFullDays, windowDays, minSent, prior, reportCap, reportWindowDays] = await Promise.all([
      getSetting('trust.weights'),
      getSetting('trust.multiplierRange'),
      getSetting('trust.ageFullDays'),
      getSetting('trust.acceptRateWindowDays'),
      getSetting('trust.acceptRateMinSent'),
      getSetting('trust.acceptRatePrior'),
      getSetting('trust.reportCap'),
      getSetting('safety.reportWindowDays'),
    ]);
    const inputs = await trustInputs(now, new Date(now.getTime() - windowDays * MS_PER_DAY), new Date(now.getTime() - reportWindowDays * MS_PER_DAY));
    const params = { ageFullDays, minSent, prior, reportCap };
    const rows = inputs.map((input) => {
      const components = trustComponents(input, params);
      const score = trustScore(components, weights);
      return { userId: input.userId, score, multiplier: trustMultiplier(score, range), components };
    });
    await saveTrustScores(rows, now);
    return { kind: 'done', resultRef: { members: rows.length } };
  },
};
