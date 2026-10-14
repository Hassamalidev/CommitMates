/**
 * Basic descriptive statistics.
 * Formula: mean = Σx / n; clamp(x, lo, hi) = min(hi, max(lo, x));
 *          σ = sqrt(Σ(x − mean)² / n); cv = σ / mean;
 *          percentile p = linear interpolation at rank p·(n − 1) of the sorted values;
 *          percentile rank of x = (count below + half the count equal) / n
 * Settings: none
 * Spec: CLAUDE.md §2.1
 */

/** Sum of the values; 0 for an empty list. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Arithmetic mean. An empty list has mean 0 so callers never divide by zero. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/** Restricts `value` to the closed interval [min, max]. NaN collapses to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Population standard deviation; 0 for fewer than two values. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length <= 1) return 0;
  const center = mean(values);
  let squares = 0;
  for (const value of values) squares += (value - center) * (value - center);
  return Math.sqrt(squares / values.length);
}

/** Standard deviation divided by the mean: how bursty a series is. 0 when the mean is 0. */
export function coefficientOfVariation(values: readonly number[]): number {
  const center = mean(values);
  if (center === 0) return 0;
  return standardDeviation(values) / center;
}

/**
 * The value at fraction `p` (0–1) of the distribution, interpolating between neighbors.
 * The input does not need to be sorted. An empty list gives 0.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = clamp(p, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (rank - lower);
}

/**
 * Where `value` stands among `samples`, in [0, 1]: the share of samples below it plus
 * half the share equal to it. An empty sample gives 0.
 */
export function percentileRank(samples: readonly number[], value: number): number {
  if (samples.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const sample of samples) {
    if (sample < value) below += 1;
    else if (sample === value) equal += 1;
  }
  return (below + equal * 0.5) / samples.length;
}
