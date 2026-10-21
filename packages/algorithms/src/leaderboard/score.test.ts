import { describe, expect, it } from 'vitest';

import { activeDays, boardMetrics, boardScores, competitionRanks, minMaxNormalize } from './score';

const WEIGHTS = { activeRatio: 0.5, medianActiveDays: 0.3, revivals: 0.1, helpfulReviews: 0.1 };

describe('activeDays', () => {
  it('counts days with a contribution once, however many there were', () => {
    expect(activeDays([0, 1, 40, 0, 2, 0, 0])).toBe(3);
    expect(activeDays([])).toBe(0);
  });
});

describe('boardMetrics', () => {
  it('measures per capita: the share of active members and their median active days', () => {
    expect(boardMetrics([5, 3, 1, 0], 3, 2, 4)).toEqual({ activeRatio: 0.5, medianActiveDays: 2, revivals: 2, helpfulReviews: 4 });
    expect(boardMetrics([], 3, 0, 0)).toEqual({ activeRatio: 0, medianActiveDays: 0, revivals: 0, helpfulReviews: 0 });
  });

  it('does not let size win: a small university with active members beats a large one with few', () => {
    const small = boardMetrics([6, 5, 5, 4], 3, 0, 0);
    const large = boardMetrics([7, 6, ...Array.from({ length: 98 }, () => 0)], 3, 0, 0);
    const [smallScore, largeScore] = boardScores([small, large], WEIGHTS);
    expect(smallScore).toBeGreaterThan(largeScore!);
  });
});

describe('minMaxNormalize and boardScores', () => {
  it('normalizes within the group and weights the metrics', () => {
    expect(minMaxNormalize([2, 4, 6])).toEqual([0, 0.5, 1]);
    expect(minMaxNormalize([3, 3])).toEqual([1, 1]);
    expect(minMaxNormalize([0, 0])).toEqual([0, 0]);
    expect(minMaxNormalize([])).toEqual([]);
    const scores = boardScores(
      [
        { activeRatio: 1, medianActiveDays: 5, revivals: 0, helpfulReviews: 2 },
        { activeRatio: 0.5, medianActiveDays: 3, revivals: 1, helpfulReviews: 0 },
      ],
      WEIGHTS,
    );
    expect(scores[0]).toBeCloseTo(0.5 + 0.3 + 0 + 0.1);
    expect(scores[1]).toBeCloseTo(0 + 0 + 0.1 + 0);
  });
});

describe('competitionRanks', () => {
  it('gives ties the same rank and skips the next', () => {
    expect(competitionRanks([0.2, 0.9, 0.9, 0.5], (a, b) => b - a)).toEqual([4, 1, 1, 3]);
    const people = [
      { days: 5, reviews: 0 },
      { days: 5, reviews: 2 },
      { days: 3, reviews: 9 },
    ];
    expect(competitionRanks(people, (a, b) => b.days - a.days || b.reviews - a.reviews)).toEqual([2, 1, 3]);
    expect(competitionRanks([], () => 0)).toEqual([]);
  });
});
