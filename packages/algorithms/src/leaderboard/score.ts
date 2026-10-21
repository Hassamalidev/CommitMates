/**
 * Leaderboards.
 * Formula: a member is active in a week with at least `minActiveDays` days that have a contribution
 *   (a day counts once, however many contributions it has). Per group: activeRatio = active ÷ verified,
 *   medianActiveDays, revivals and helpful reviews of the week. Each metric is min-max normalized among
 *   the group's entries (all equal → 1 when above zero, else 0); score = Σ weight × normalized metric.
 *   Ranks are competition ranks (ties share a rank; the next rank skips).
 * Settings: leaderboard.minActiveDays, leaderboard.weights (passed in)
 * Spec: CLAUDE.md §8 F19
 */
import { median } from '../stats/basic';

export type BoardMetrics = { activeRatio: number; medianActiveDays: number; revivals: number; helpfulReviews: number };
export type BoardWeights = BoardMetrics;

/** Days in a week with at least one contribution: commit spam on one day counts once (§8 F19 step 1). */
export const activeDays = (dailyCounts: readonly number[]): number => dailyCounts.filter((count) => count >= 1).length;

/** A group's metrics from its members' active days and the week's revivals and helpful reviews. */
export function boardMetrics(memberActiveDays: readonly number[], minActiveDays: number, revivals: number, helpfulReviews: number): BoardMetrics {
  const active = memberActiveDays.filter((days) => days >= minActiveDays).length;
  return {
    activeRatio: memberActiveDays.length === 0 ? 0 : active / memberActiveDays.length,
    medianActiveDays: memberActiveDays.length === 0 ? 0 : median(memberActiveDays),
    revivals,
    helpfulReviews,
  };
}

/** Min-max normalization to [0, 1]; when every value is the same, 1 if it is above zero, else 0. */
export function minMaxNormalize(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high === low) return values.map(() => (high > 0 ? 1 : 0));
  return values.map((value) => (value - low) / (high - low));
}

/** Weighted scores of a group's entries, each metric normalized among them (§8 F19 step 4). */
export function boardScores(entries: readonly BoardMetrics[], weights: BoardWeights): number[] {
  const keys = ['activeRatio', 'medianActiveDays', 'revivals', 'helpfulReviews'] as const; // allowed-literal: the field names of BoardMetrics
  const normalized = Object.fromEntries(keys.map((key) => [key, minMaxNormalize(entries.map((entry) => entry[key]))])) as Record<(typeof keys)[number], number[]>;
  return entries.map((_, index) => keys.reduce((sum, key) => sum + weights[key] * (normalized[key][index] ?? 0), 0));
}

/**
 * Competition ranks for values sorted by `compare` (best first): equal entries share a rank and the
 * next rank skips, so "1, 2, 2, 4".
 */
export function competitionRanks<T>(entries: readonly T[], compare: (a: T, b: T) => number): number[] {
  const order = entries.map((entry, index) => ({ entry, index })).sort((a, b) => compare(a.entry, b.entry));
  const ranks = new Array<number>(entries.length).fill(0);
  order.forEach((item, position) => {
    const previous = order[position - 1];
    ranks[item.index] = previous && compare(previous.entry, item.entry) === 0 ? (ranks[previous.index] ?? position + 1) : position + 1;
  });
  return ranks;
}
