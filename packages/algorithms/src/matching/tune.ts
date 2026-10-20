/**
 * Nightly match-weight tuning and pair-companion stage thresholds.
 * Formula:
 *   diff_k  = mean of component k over successful suggestions − mean over unsuccessful ones
 *   target  = w + step · diff / max|diff|, negatives set to 0, renormalized to sum 1
 *   result  = w + (target − w) · min(1, step / max|target − w|)   (no weight moves more than `step`)
 *   stages  = quantiles of ended-streak lengths at k/(n+1), k = 1…n, rounded, each at least 1 and
 *             above the one before
 * Settings: matching.weights, matching.weightStep, streaks.companionStageDays (passed in)
 * Spec: CLAUDE.md §8 F11 "Weight tuning", §5.5.1
 */

import type { MatchComponents, ModeWeights } from './match';

const COMPONENTS = ['sim', 'int', 'comp'] as const; // allowed-literal: the three score components (§8 F11)

/** Mean of each component over a set of suggestions; zeros for an empty set. */
export function componentMeans(rows: readonly MatchComponents[]): MatchComponents {
  const sum = { sim: 0, int: 0, comp: 0 };
  for (const row of rows) for (const key of COMPONENTS) sum[key] += row[key];
  const count = rows.length;
  return count === 0 ? sum : { sim: sum.sim / count, int: sum.int / count, comp: sum.comp / count };
}

/** Equal weights, for the degenerate case where every weight is zero. */
const EQUAL = 1 / COMPONENTS.length;

const normalize = (weights: ModeWeights): ModeWeights => {
  const total = weights.sim + weights.int + weights.comp;
  return total > 0 ? { sim: weights.sim / total, int: weights.int / total, comp: weights.comp / total } : { sim: EQUAL, int: EQUAL, comp: EQUAL };
};

/**
 * One night's move of a mode's weights toward the components that set successful suggestions apart.
 * Unchanged when the two groups do not differ.
 */
export function tuneModeWeights(current: ModeWeights, success: MatchComponents, failure: MatchComponents, step: number): ModeWeights {
  const diff = { sim: success.sim - failure.sim, int: success.int - failure.int, comp: success.comp - failure.comp };
  const largest = Math.max(...COMPONENTS.map((key) => Math.abs(diff[key])));
  if (largest === 0 || step <= 0) return current;
  const target = normalize({
    sim: Math.max(0, current.sim + (step * diff.sim) / largest),
    int: Math.max(0, current.int + (step * diff.int) / largest),
    comp: Math.max(0, current.comp + (step * diff.comp) / largest),
  });
  const base = normalize(current);
  const move = Math.max(...COMPONENTS.map((key) => Math.abs(target[key] - base[key])));
  const scale = move > step ? step / move : 1;
  return {
    sim: base.sim + (target.sim - base.sim) * scale,
    int: base.int + (target.int - base.int) * scale,
    comp: base.comp + (target.comp - base.comp) * scale,
  };
}

/** Quantile levels for `count` thresholds, spread evenly: k/(count+1). */
export function evenLevels(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) / (count + 1));
}

/** Stage thresholds from quantile values: whole days, at least 1, each above the one before. */
export function stageDaysFrom(values: readonly number[]): number[] {
  const days: number[] = [];
  for (const value of values) days.push(Math.max(Math.round(value), (days.at(-1) ?? 0) + 1, 1));
  return days;
}
