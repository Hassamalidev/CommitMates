import { describe, expect, it } from 'vitest';

import { trustComponents, trustMultiplier, trustScore } from './trust';

const params = { ageFullDays: 30, minSent: 3, prior: 0.5, reportCap: 3 };
const weights = { age: 0.25, verified: 0.25, acceptRate: 0.3, reports: -0.2 };

describe('trust', () => {
  it('computes each component with its cap and prior', () => {
    expect(trustComponents({ accountAgeDays: 15, verified: true, sent: 4, accepted: 3, distinctReporters: 1 }, params)).toEqual({
      age: 0.5,
      verified: 1,
      acceptRate: 0.75,
      reports: 1 / 3,
    });
    // Few requests sent: the prior stands in; many reporters: capped; old account: full.
    expect(trustComponents({ accountAgeDays: 400, verified: false, sent: 2, accepted: 0, distinctReporters: 9 }, params)).toEqual({
      age: 1,
      verified: 0,
      acceptRate: 0.5,
      reports: 1,
    });
  });

  it('weighs the components, clamped to [0, 1]', () => {
    // 0.25·0.5 + 0.25·1 + 0.3·0.75 − 0.2·(1/3)
    expect(trustScore({ age: 0.5, verified: 1, acceptRate: 0.75, reports: 1 / 3 }, weights)).toBeCloseTo(0.533333, 5);
    expect(trustScore({ age: 0, verified: 0, acceptRate: 0, reports: 1 }, weights)).toBe(0);
    expect(trustScore({ age: 1, verified: 1, acceptRate: 1, reports: 0 }, { ...weights, acceptRate: 1 })).toBe(1);
  });

  it('maps the score onto the multiplier range', () => {
    expect(trustMultiplier(0, [0.5, 3])).toBe(0.5);
    expect(trustMultiplier(1, [0.5, 3])).toBe(3);
    expect(trustMultiplier(0.4, [0.5, 3])).toBeCloseTo(1.5, 10);
    expect(trustMultiplier(0.4, [3, 0.5])).toBe(1);
    expect(trustMultiplier(0.4, [])).toBe(1);
  });

  it('treats a zero cap or window as no penalty and full age', () => {
    expect(trustComponents({ accountAgeDays: 1, verified: true, sent: 0, accepted: 0, distinctReporters: 2 }, { ...params, ageFullDays: 0, reportCap: 0, minSent: 0 })).toEqual({
      age: 1,
      verified: 1,
      acceptRate: 0.5,
      reports: 0,
    });
  });
});
