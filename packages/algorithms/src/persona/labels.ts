/**
 * Coding-personality labels and the activity score.
 * Formula: a label applies when metric ≥ threshold; strength = metric / threshold;
 *          at most three labels, strongest first; none → "balanced";
 *          activity score = percentile rank among samples, or before enough samples exist
 *          min(1, log10(1 + x) / log10(1 + ref));
 *          stage = index of the first stage cut above the activity score
 * Settings: persona.nightOwl.share, persona.earlyBird.share, persona.weekendWarrior.share,
 *           persona.sprinter.cv, persona.marathoner.activeDayShare, companion.activityRef,
 *           companion.stageCuts
 * Spec: CLAUDE.md §8 F1 steps 7–9
 */

import { clamp } from '../stats/basic';

import type { RhythmMetrics } from './metrics';

export type PersonaLabelKey = 'nightOwl' | 'earlyBird' | 'weekendWarrior' | 'sprinter' | 'marathoner' | 'balanced';

export type PersonaLabel = { key: PersonaLabelKey; strength: number };

/** The threshold of each label, read from settings by the caller. */
export type LabelThresholds = {
  nightOwl: number;
  earlyBird: number;
  weekendWarrior: number;
  sprinter: number;
  marathoner: number;
};

/** Labels shown on a card at most (§8 F1 step 7). */
export const MAX_LABELS = 3;

/** Which metric each label compares with its threshold. */
const LABEL_METRIC: Readonly<Record<keyof LabelThresholds, keyof RhythmMetrics>> = {
  nightOwl: 'nightShare',
  earlyBird: 'morningShare',
  weekendWarrior: 'weekendShare',
  sprinter: 'cv',
  marathoner: 'activeDayShare',
};

/**
 * The labels a person earns, strongest first, at most `MAX_LABELS`. Someone who earns
 * none is "balanced". A threshold of zero or less disables its label.
 */
export function personaLabels(metrics: RhythmMetrics, thresholds: LabelThresholds): PersonaLabel[] {
  const earned: PersonaLabel[] = [];
  for (const key of Object.keys(LABEL_METRIC) as (keyof LabelThresholds)[]) {
    const threshold = thresholds[key];
    const metric = metrics[LABEL_METRIC[key]];
    if (!(threshold > 0) || !(metric >= threshold)) continue;
    earned.push({ key, strength: metric / threshold });
  }
  if (earned.length === 0) return [{ key: 'balanced', strength: 0 }];
  return earned.sort((a, b) => b.strength - a.strength).slice(0, MAX_LABELS);
}

/**
 * Activity score before enough samples exist: a logarithmic scale on which `reference`
 * contributions in a year map to 1.
 */
export function fallbackActivityScore(total: number, reference: number): number {
  if (!(total > 0) || !(reference > 0)) return 0;
  return clamp(Math.log10(1 + total) / Math.log10(1 + reference), 0, 1);
}

/**
 * Activity score in [0, 1]. `rank` is the percentile rank among recorded samples, or
 * `null` while there are too few; then the logarithmic fallback applies.
 */
export function activityScore(total: number, rank: number | null, reference: number): number {
  return rank === null ? fallbackActivityScore(total, reference) : clamp(rank, 0, 1);
}

/** Evolution stage: the index of the first cut above the score; past every cut it is `cuts.length`. */
export function companionStage(score: number, cuts: readonly number[]): number {
  const sorted = [...cuts].sort((a, b) => a - b);
  const index = sorted.findIndex((cut) => cut > score);
  return index === -1 ? sorted.length : index;
}
