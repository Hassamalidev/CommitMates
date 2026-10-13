/**
 * Basic descriptive statistics.
 * Formula: mean = Σx / n; clamp(x, lo, hi) = min(hi, max(lo, x))
 * Settings: none
 * Spec: CLAUDE.md §2.1
 */

/** Arithmetic mean. An empty list has mean 0 so callers never divide by zero. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Restricts `value` to the closed interval [min, max]. NaN collapses to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
