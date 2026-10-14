import { describe, expect, it } from 'vitest';

import { clamp, coefficientOfVariation, mean, percentile, percentileRank, standardDeviation, sum } from './basic';

describe('sum and mean', () => {
  it('returns 0 for an empty list', () => {
    expect(sum([])).toBe(0);
    expect(mean([])).toBe(0);
  });

  it('adds and averages values', () => {
    expect(sum([1, 2, 3, 6])).toBe(12);
    expect(mean([4])).toBe(4);
    expect(mean([1, 2, 3, 6])).toBe(3);
  });
});

describe('clamp', () => {
  it('keeps values inside the interval', () => {
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('pins values outside the interval to its bounds', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(7, 0, 1)).toBe(1);
  });

  it('maps NaN to the lower bound', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('standardDeviation and coefficientOfVariation', () => {
  it('matches a hand-computed population', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(standardDeviation(values)).toBe(2);
    expect(coefficientOfVariation(values)).toBe(0.4);
  });

  it('is 0 for empty, single and constant series, and when the mean is 0', () => {
    expect(standardDeviation([])).toBe(0);
    expect(standardDeviation([5])).toBe(0);
    expect(standardDeviation([3, 3, 3])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });
});

describe('percentile', () => {
  it('interpolates between neighbors of the sorted values', () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(percentile([50, 10, 40, 20, 30], 0.8)).toBeCloseTo(42, 10);
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 1)).toBe(30);
  });

  it('handles empty input, a single value and out-of-range fractions', () => {
    expect(percentile([], 0.8)).toBe(0);
    expect(percentile([7], 0.8)).toBe(7);
    expect(percentile([1, 2], 5)).toBe(2);
    expect(percentile([1, 2], -1)).toBe(1);
  });

  it('does not reorder its input', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('percentileRank', () => {
  it('counts samples below plus half of the ties', () => {
    expect(percentileRank([1, 2, 2, 3], 2)).toBe(0.5);
    expect(percentileRank([1, 2, 3, 4], 10)).toBe(1);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
    expect(percentileRank([5, 5], 5)).toBe(0.5);
  });

  it('is 0 without samples', () => {
    expect(percentileRank([], 3)).toBe(0);
  });
});
