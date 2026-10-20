import { describe, expect, it } from 'vitest';

import { componentMeans, evenLevels, stageDaysFrom, tuneModeWeights } from './tune';

const study = { sim: 0.6, int: 0.3, comp: 0.1 };
const sum = (weights: { sim: number; int: number; comp: number }) => weights.sim + weights.int + weights.comp;

describe('tuneModeWeights', () => {
  it('moves toward the components that set successes apart, never more than the step', () => {
    const tuned = tuneModeWeights(study, { sim: 0.2, int: 0.3, comp: 0.9 }, { sim: 0.5, int: 0.3, comp: 0.2 }, 0.05);
    expect(sum(tuned)).toBeCloseTo(1, 10);
    expect(tuned.comp).toBeGreaterThan(study.comp);
    expect(tuned.sim).toBeLessThan(study.sim);
    for (const key of ['sim', 'int', 'comp'] as const) expect(Math.abs(tuned[key] - study[key])).toBeLessThanOrEqual(0.05 + 1e-12);
  });

  it('stays put when successes and failures look alike, or the step is zero', () => {
    const same = { sim: 0.4, int: 0.4, comp: 0.4 };
    expect(tuneModeWeights(study, same, same, 0.05)).toEqual(study);
    expect(tuneModeWeights(study, { sim: 1, int: 0, comp: 0 }, same, 0)).toEqual(study);
  });

  it('never lets a weight go below zero, and still sums to 1', () => {
    const tuned = tuneModeWeights({ sim: 0.02, int: 0.49, comp: 0.49 }, { sim: 0, int: 0.5, comp: 0.5 }, { sim: 1, int: 0.5, comp: 0.5 }, 0.1);
    expect(tuned.sim).toBeGreaterThanOrEqual(0);
    expect(sum(tuned)).toBeCloseTo(1, 10);
  });
});

describe('componentMeans', () => {
  it('averages each component and is zero for no rows', () => {
    expect(componentMeans([{ sim: 0.2, int: 0.4, comp: 0 }, { sim: 0.4, int: 0, comp: 1 }])).toEqual({ sim: 0.30000000000000004, int: 0.2, comp: 0.5 });
    expect(componentMeans([])).toEqual({ sim: 0, int: 0, comp: 0 });
  });
});

describe('stage thresholds', () => {
  it('spreads quantile levels evenly and keeps the days whole, positive and increasing', () => {
    expect(evenLevels(4)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(stageDaysFrom([0.4, 1.2, 1.4, 9.6, 30])).toEqual([1, 2, 3, 10, 30]);
  });
});
