/**
 * Similarity measures.
 * Formula: cosine(a, b) = Σ a_k·b_k / (|a|·|b|) over sparse vectors;
 *          jaccard(A, B) = |A ∩ B| / |A ∪ B|;
 *          histogram intersection(h, g) = Σ min(h_i, g_i) for normalized histograms
 * Settings: none
 * Spec: CLAUDE.md §2.1, §8 F2 steps 1–3, §8 F11
 */

export type SparseVector = Readonly<Record<string, number>>;

/** Cosine similarity of two sparse vectors; 0 when either is empty or all zeros. */
export function cosine(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, value] of Object.entries(a)) {
    normA += value * value;
    const other = b[key];
    if (other !== undefined) dot += value * other;
  }
  for (const value of Object.values(b)) normB += value * value;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard similarity of two sets; 0 when both are empty. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Overlap of two normalized histograms of the same length: 1 when identical, 0 when disjoint. */
export function histogramIntersection(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let overlap = 0;
  for (let index = 0; index < length; index += 1) overlap += Math.min(a[index] ?? 0, b[index] ?? 0);
  return overlap;
}
