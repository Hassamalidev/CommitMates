/**
 * Skill vectors weighted within a university.
 * Formula: w(t) = tf(t) × ln(1 + N / df(t)), N = members, df(t) = members whose base vector has t;
 *   each vector is then L2-normalized. Rare skills in a university count for more than ubiquitous ones.
 * Settings: none (N and df come from the data)
 * Spec: CLAUDE.md §8 F11 "Vectors" steps 2–3
 */

import type { SparseVector } from '../similarity/similarity';

/** Scales a vector to unit length; an all-zero vector stays empty. */
export function l2Normalize(vector: SparseVector): Record<string, number> {
  const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return {};
  return Object.fromEntries(Object.entries(vector).map(([key, value]) => [key, value / norm]));
}

/** TF-IDF vectors for every member of one university, keyed like `bases`. */
export function tfidfVectors<K>(bases: ReadonlyMap<K, SparseVector>): Map<K, Record<string, number>> {
  const members = bases.size;
  const documentFrequency = new Map<string, number>();
  for (const base of bases.values()) {
    for (const [tag, tf] of Object.entries(base)) {
      if (tf > 0) documentFrequency.set(tag, (documentFrequency.get(tag) ?? 0) + 1);
    }
  }
  const result = new Map<K, Record<string, number>>();
  for (const [key, base] of bases) {
    const weighted: Record<string, number> = {};
    for (const [tag, tf] of Object.entries(base)) {
      const df = documentFrequency.get(tag);
      if (tf > 0 && df !== undefined) weighted[tag] = tf * Math.log(1 + members / df);
    }
    result.set(key, l2Normalize(weighted));
  }
  return result;
}

/** The `k` heaviest tags, ties broken alphabetically so the order is stable. */
export function topTags(vector: SparseVector, k: number): string[] {
  return Object.entries(vector)
    .filter(([, weight]) => weight > 0)
    .sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b))
    .slice(0, k)
    .map(([tag]) => tag);
}

/** Merges named weights into one vector, keeping the larger weight when a key repeats. */
export function mergeMax(entries: Iterable<readonly [string, number]>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [key, weight] of entries) {
    if (weight > (merged[key] ?? 0)) merged[key] = weight;
  }
  return merged;
}
