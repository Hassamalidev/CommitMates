import { MATCH_MODES, componentMeans, tuneModeWeights, type MatchMode, type ModeWeights } from '@commitmates/algorithms';
import { getSetting, setComputed, tuningSamples } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

export type TuningReport = { tuned: MatchMode[]; successes: Record<MatchMode, number>; weights: Record<MatchMode, ModeWeights> };

/**
 * Tunes the mode weights from the last `matching.tuneWindowDays` of acted-on suggestions
 * (CLAUDE.md §8 F11 "Weight tuning"): a mode moves, by at most `matching.weightStep`, toward the
 * components whose means set successful matches apart from the rest, and only once it has at least
 * `matching.tuneMinSuccesses` successes. The result is written as the computed value of
 * `matching.weights`, with history.
 */
export async function tuneMatchWeights(now: Date = new Date()): Promise<TuningReport> {
  const [current, step, minSuccesses, messages, successDays, windowDays] = await Promise.all([
    getSetting('matching.weights'),
    getSetting('matching.weightStep'),
    getSetting('matching.tuneMinSuccesses'),
    getSetting('matching.successMessages'),
    getSetting('matching.successWindowDays'),
    getSetting('matching.tuneWindowDays'),
  ]);
  const samples = await tuningSamples(new Date(now.getTime() - windowDays * MS_PER_DAY), messages, successDays);
  const weights = { ...current };
  const successes = { study: 0, teammate: 0, explore: 0 };
  const tuned: MatchMode[] = [];
  for (const mode of MATCH_MODES) {
    const rows = samples.filter((sample) => sample.mode === mode);
    const good = rows.filter((sample) => sample.success).map((sample) => sample.components);
    const rest = rows.filter((sample) => !sample.success).map((sample) => sample.components);
    successes[mode] = good.length;
    if (good.length < minSuccesses || rest.length === 0) continue;
    weights[mode] = tuneModeWeights(current[mode], componentMeans(good), componentMeans(rest), step);
    tuned.push(mode);
  }
  if (tuned.length > 0) {
    // The sample size is the successes behind the change, so the value takes effect at min_sample.
    await setComputed('matching.weights', weights, Math.min(...tuned.map((mode) => successes[mode])));
  }
  return { tuned, successes, weights };
}

const payloadSchema = z.object({});

/** Nightly before the decks are built (§5.4 `tune_match_weights`). */
export const tuneMatchWeightsJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'tune_match_weights',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const report = await tuneMatchWeights(ctx.now());
    return { kind: 'done', resultRef: { tuned: report.tuned, successes: report.successes } };
  },
};
