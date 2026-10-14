/**
 * Coding-partner compatibility.
 * Formula: skill = cosine(langs ∪ tags of A, langs ∪ tags of B);
 *          interest = jaccard(topics A, topics B);
 *          rhythm = Σ_h min(hA[h], hB[h]) on UTC hour histograms;
 *          complement = mean over the union of both top-10 tags of |a[t] − b[t]|;
 *          score = round(100 × Σ w_k·c_k / Σ w_k) over the components that could be computed;
 *          band = the highest band whose min ≤ score
 * Settings: compat.weights, compat.bands
 * Spec: CLAUDE.md §8 F2 "Algorithm"
 */

import { percentile } from '../stats/basic';
import { cosine, histogramIntersection, jaccard, type SparseVector } from '../similarity/similarity';

/** Tags per person that the complement compares (§8 F2 step 4). */
export const COMPLEMENT_TOP_TAGS = 10;
/** Items shown per explanation list (§8 F2 step 6). */
export const MAX_EXPLANATION_ITEMS = 3;
/** The midpoint of a distribution, as a fraction. */
const MEDIAN = 0.5;

export type CompatComponent = 'skill' | 'interest' | 'rhythm' | 'complement';

export type CompatWeights = Readonly<Record<CompatComponent, number>>;

export type CompatBand = { min: number; key: string };

export type CompatSide = {
  languages: readonly { name: string; share: number }[];
  /** Weights already scaled to [0, 1] by the person's largest. */
  tags: readonly { tag: string; weight: number }[];
  /** Topics of the person's own repositories together with those of the repositories they starred. */
  topics: readonly string[];
  /** 24 shares in UTC; all zeros when there is no activity to read. */
  hourHistUtc: readonly number[];
  /** Full names (`owner/repo`, lowercased) of starred repositories. */
  starred: readonly string[];
};

/** Language shares and tag weights as one sparse vector (§8 F1 steps 5–6). */
export function skillVector(side: Pick<CompatSide, 'languages' | 'tags'>): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const language of side.languages) vector[`lang:${language.name}`] = language.share;
  for (const tag of side.tags) vector[`tag:${tag.tag}`] = tag.weight;
  return vector;
}

const isEmpty = (vector: SparseVector) => !Object.values(vector).some((value) => value > 0);
const hasActivity = (histogram: readonly number[]) => histogram.some((share) => share > 0);

/** The four components; `null` where one side has nothing to compare. */
export function compatComponents(a: CompatSide, b: CompatSide): Record<CompatComponent, number | null> {
  const vectorA = skillVector(a);
  const vectorB = skillVector(b);
  const topicsA = new Set(a.topics);
  const topicsB = new Set(b.topics);
  const complementTags = topTagUnion(a, b);

  return {
    skill: isEmpty(vectorA) || isEmpty(vectorB) ? null : cosine(vectorA, vectorB),
    interest: topicsA.size === 0 || topicsB.size === 0 ? null : jaccard(topicsA, topicsB),
    rhythm: hasActivity(a.hourHistUtc) && hasActivity(b.hourHistUtc) ? histogramIntersection(a.hourHistUtc, b.hourHistUtc) : null,
    complement: complementTags.length === 0 || a.tags.length === 0 || b.tags.length === 0 ? null : complement(a, b, complementTags),
  };
}

function topTagUnion(a: CompatSide, b: CompatSide): string[] {
  const top = (side: CompatSide) =>
    [...side.tags]
      .sort((x, y) => y.weight - x.weight || (x.tag < y.tag ? -1 : 1))
      .slice(0, COMPLEMENT_TOP_TAGS)
      .map((tag) => tag.tag);
  return [...new Set([...top(a), ...top(b)])];
}

function complement(a: CompatSide, b: CompatSide, tags: readonly string[]): number {
  const weightsA = new Map(a.tags.map((tag) => [tag.tag, tag.weight]));
  const weightsB = new Map(b.tags.map((tag) => [tag.tag, tag.weight]));
  let total = 0;
  for (const tag of tags) total += Math.abs((weightsA.get(tag) ?? 0) - (weightsB.get(tag) ?? 0));
  return total / tags.length;
}

/**
 * The 0–100 score from the components that could be computed, re-weighting the rest
 * proportionally. `null` when none could.
 */
export function compatScore(components: Readonly<Record<CompatComponent, number | null>>, weights: CompatWeights): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const key of Object.keys(weights) as CompatComponent[]) {
    const value = components[key];
    const weight = weights[key];
    if (value === null || !(weight > 0)) continue;
    weighted += weight * value;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  // allowed-literal: a score out of 100
  return Math.round((100 * weighted) / weightSum);
}

/** The band of a score: the highest band whose `min` is at most the score. */
export function compatBand(score: number, bands: readonly CompatBand[]): string | null {
  let chosen: CompatBand | null = null;
  for (const band of bands) {
    if (band.min <= score && (chosen === null || band.min > chosen.min)) chosen = band;
  }
  return chosen?.key ?? null;
}

export type HourWindow = { startHourUtc: number; hours: number };

/**
 * The longest run of hours (wrapping past midnight) in which both people are more active
 * than their own median hour. `null` when no hour qualifies.
 */
export function sharedActiveWindow(a: readonly number[], b: readonly number[]): HourWindow | null {
  const length = Math.min(a.length, b.length);
  if (length === 0) return null;
  const medianA = percentile(a.slice(0, length), MEDIAN);
  const medianB = percentile(b.slice(0, length), MEDIAN);
  const both = Array.from({ length }, (_, hour) => (a[hour] ?? 0) > medianA && (b[hour] ?? 0) > medianB);
  if (both.every(Boolean)) return { startHourUtc: 0, hours: length };

  let best: HourWindow | null = null;
  // Start only at the beginning of a run, so a run across midnight is counted once.
  for (let start = 0; start < length; start += 1) {
    if (!both[start] || both[(start - 1 + length) % length]) continue;
    let hours = 0;
    while (both[(start + hours) % length] && hours < length) hours += 1;
    if (best === null || hours > best.hours) best = { startHourUtc: start, hours };
  }
  return best;
}

export type CompatExplanations = {
  sharedTags: string[];
  sharedStars: string[];
  window: HourWindow | null;
  /** The tag where A is strongest relative to B, and the reverse. */
  strengthA: string | null;
  strengthB: string | null;
};

/** The "why" behind a score: real shared signals only (§8 F2 step 6). */
export function compatExplanations(a: CompatSide, b: CompatSide): CompatExplanations {
  const weightsA = new Map(a.tags.map((tag) => [tag.tag, tag.weight]));
  const weightsB = new Map(b.tags.map((tag) => [tag.tag, tag.weight]));

  const sharedTags = [...weightsA.keys()]
    .filter((tag) => weightsB.has(tag))
    .map((tag) => ({ tag, weight: Math.min(weightsA.get(tag) ?? 0, weightsB.get(tag) ?? 0) }))
    .sort((x, y) => y.weight - x.weight || (x.tag < y.tag ? -1 : 1))
    .slice(0, MAX_EXPLANATION_ITEMS)
    .map((entry) => entry.tag);

  const starredB = new Set(b.starred);
  const sharedStars = [...new Set(a.starred)].filter((repo) => starredB.has(repo)).slice(0, MAX_EXPLANATION_ITEMS);

  const strongest = (mine: Map<string, number>, theirs: Map<string, number>): string | null => {
    let best: { tag: string; gap: number } | null = null;
    for (const [tag, weight] of mine) {
      const gap = weight - (theirs.get(tag) ?? 0);
      if (gap > 0 && (best === null || gap > best.gap || (gap === best.gap && tag < best.tag))) best = { tag, gap };
    }
    return best?.tag ?? null;
  };

  return {
    sharedTags,
    sharedStars,
    window: sharedActiveWindow(a.hourHistUtc, b.hourHistUtc),
    strengthA: strongest(weightsA, weightsB),
    strengthB: strongest(weightsB, weightsA),
  };
}
