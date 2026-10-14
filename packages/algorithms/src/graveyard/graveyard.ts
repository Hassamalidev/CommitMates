/**
 * Project Graveyard: how unfinished, how worth reviving, and how hard an inactive project is.
 * Formula: unfinished u = mean of the signals that apply, minus 0.25 with releases or tags,
 *            minus 0.25 when every issue is closed and there were more than 5, minus 0.15 with a
 *            usage or installation heading, clamped to [0, 1];
 *          promise = log10(1 + stars + 2·forks); demand = log10(1 + openIssues + recentStars);
 *          freshness = 1 if idle ≤ freshMonths else 0.5; legal = 1 with a license else noLicenseFactor;
 *          revivability = (wP·promise_n + wD·demand_n + wU·u + wF·freshness) × legal, with promise_n and
 *            demand_n min–max normalized within the candidate set;
 *          rank = relevance × revivability; difficulty labels relative to the set's median and p75
 * Settings: graveyard.weights, graveyard.freshMonths, graveyard.noLicenseFactor
 * Spec: CLAUDE.md §8 F7 steps 5–9
 */

import { clamp, percentile } from '../stats/basic';

/** Subtracted from the unfinished score for each sign of a finished project (§8 F7 step 6). */
export const RELEASE_DISCOUNT = 0.25;
export const ALL_CLOSED_DISCOUNT = 0.25;
export const USAGE_HEADING_DISCOUNT = 0.15;
/** "All issues closed" counts only with more issues than this (§8 F7 step 6). */
export const MIN_CLOSED_ISSUES = 5;
/** Forks weigh twice as much as stars in promise (§8 F7 step 7). */
export const FORK_WEIGHT = 2;
/** Freshness of a project idle for longer than `freshMonths`. */
export const STALE_FRESHNESS = 0.5;
/** Unfinished score from which a project is a "half-built idea" (§8 F7 step 9). */
export const HALF_BUILT_AT = 0.5;
const MEDIAN = 0.5;
const UPPER_QUARTILE = 0.75;

const USAGE_HEADING = /^#{1,6}\s*(?:usage|installation|install|getting started|quick ?start)\b/im;

export type FinishedSignals = { hasReleases: boolean; allIssuesClosed: boolean; totalIssues: number; readme: string };

/** The unfinished score after the finished signals are taken off (§8 F7 steps 5–6). */
export function adjustedUnfinished(base: number | null, finished: FinishedSignals): number {
  let score = base ?? 0;
  if (finished.hasReleases) score -= RELEASE_DISCOUNT;
  if (finished.allIssuesClosed && finished.totalIssues > MIN_CLOSED_ISSUES) score -= ALL_CLOSED_DISCOUNT;
  if (USAGE_HEADING.test(finished.readme)) score -= USAGE_HEADING_DISCOUNT;
  return clamp(score, 0, 1);
}

export type RevivalInput = {
  key: string;
  stars: number;
  forks: number;
  openIssues: number;
  recentStars: number;
  unfinished: number;
  idleMonths: number;
  hasLicense: boolean;
  sizeKb: number;
  /** 1 for the best match, falling towards 0. */
  relevance: number;
};

export type GraveyardWeights = { promise: number; demand: number; unfinished: number; freshness: number };

export type RevivalScore = {
  key: string;
  promise: number;
  demand: number;
  freshness: number;
  legal: number;
  revivability: number;
  rank: number;
  difficulty: 'weekend-fix' | 'needs-maintainer' | 'half-built' | null;
};

const minMax = (values: readonly number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (value: number) => (max === min ? 0 : (value - min) / (max - min));
};

/** Revivability, rank and difficulty for every candidate, each relative to the whole set. */
export function scoreRevivals(
  candidates: readonly RevivalInput[],
  settings: { weights: GraveyardWeights; freshMonths: number; noLicenseFactor: number },
): RevivalScore[] {
  if (candidates.length === 0) return [];
  const promise = candidates.map((candidate) => Math.log10(1 + candidate.stars + FORK_WEIGHT * candidate.forks));
  const demand = candidates.map((candidate) => Math.log10(1 + candidate.openIssues + candidate.recentStars));
  const promiseN = minMax(promise);
  const demandN = minMax(demand);
  const medianSize = percentile(candidates.map((candidate) => candidate.sizeKb), MEDIAN);
  const medianIssues = percentile(candidates.map((candidate) => candidate.openIssues), MEDIAN);
  const p75Stars = percentile(candidates.map((candidate) => candidate.stars), UPPER_QUARTILE);
  const p75Issues = percentile(candidates.map((candidate) => candidate.openIssues), UPPER_QUARTILE);
  const { weights } = settings;

  return candidates.map((candidate, index) => {
    const freshness = candidate.idleMonths <= settings.freshMonths ? 1 : STALE_FRESHNESS;
    const legal = candidate.hasLicense ? 1 : settings.noLicenseFactor;
    const revivability =
      (weights.promise * promiseN(promise[index] ?? 0) +
        weights.demand * demandN(demand[index] ?? 0) +
        weights.unfinished * candidate.unfinished +
        weights.freshness * freshness) *
      legal;
    let difficulty: RevivalScore['difficulty'] = null;
    if (candidate.sizeKb < medianSize && candidate.openIssues < medianIssues && candidate.unfinished < HALF_BUILT_AT) difficulty = 'weekend-fix';
    else if (candidate.stars > p75Stars && candidate.openIssues > p75Issues) difficulty = 'needs-maintainer';
    else if (candidate.unfinished >= HALF_BUILT_AT && candidate.sizeKb < medianSize) difficulty = 'half-built';
    return {
      key: candidate.key,
      promise: promise[index] ?? 0,
      demand: demand[index] ?? 0,
      freshness,
      legal,
      revivability,
      rank: candidate.relevance * revivability,
      difficulty,
    };
  });
}

/** Whole months between two instants (30.44-day months), never negative. */
export function monthsBetween(from: Date, to: Date): number {
  // allowed-literal: average days per month, for idle time in months
  const DAYS_PER_MONTH = 30.44;
  const days = (to.getTime() - from.getTime()) / 86_400_000; // allowed-literal: ms per day
  return Math.max(0, days / DAYS_PER_MONTH);
}
