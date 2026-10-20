/**
 * Trust score and multiplier.
 * Formula:
 *   age        = min(1, account days ÷ ageFullDays)
 *   verified   = 1 if the university is verified, else 0
 *   acceptRate = accepted ÷ sent requests in the window; `prior` when fewer than `minSent` were sent
 *   reports    = min(distinct verified reporters in the window, reportCap) ÷ reportCap
 *   score      = clamp(Σ w_k · component_k, 0, 1)   (the reports weight is negative)
 *   multiplier = min + score · (max − min) over `range`
 * Settings: trust.weights, trust.multiplierRange, trust.ageFullDays, trust.acceptRateMinSent,
 *           trust.acceptRatePrior, trust.reportCap (passed in)
 * Spec: CLAUDE.md §8 F12 "Trust score"
 */

import { clamp } from '../stats/basic';

export type TrustInputs = { accountAgeDays: number; verified: boolean; sent: number; accepted: number; distinctReporters: number };
export type TrustWeights = { age: number; verified: number; acceptRate: number; reports: number };
export type TrustComponents = TrustWeights;
export type TrustParams = { ageFullDays: number; minSent: number; prior: number; reportCap: number };

export function trustComponents(inputs: TrustInputs, params: TrustParams): TrustComponents {
  const age = params.ageFullDays > 0 ? clamp(inputs.accountAgeDays / params.ageFullDays, 0, 1) : 1;
  const acceptRate = inputs.sent < params.minSent || inputs.sent === 0 ? params.prior : clamp(inputs.accepted / inputs.sent, 0, 1);
  const reports = params.reportCap > 0 ? Math.min(Math.max(0, inputs.distinctReporters), params.reportCap) / params.reportCap : 0;
  return { age, verified: inputs.verified ? 1 : 0, acceptRate, reports };
}

export function trustScore(components: TrustComponents, weights: TrustWeights): number {
  const raw =
    weights.age * components.age +
    weights.verified * components.verified +
    weights.acceptRate * components.acceptRate +
    weights.reports * components.reports;
  return clamp(raw, 0, 1);
}

/** Maps a score in [0, 1] linearly onto the multiplier range; a malformed range gives 1. */
export function trustMultiplier(score: number, range: readonly number[]): number {
  const [min, max] = range;
  if (min === undefined || max === undefined || max < min) return 1;
  return min + clamp(score, 0, 1) * (max - min);
}
