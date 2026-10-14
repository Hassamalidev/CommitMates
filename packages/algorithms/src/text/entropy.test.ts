import { describe, expect, it } from 'vitest';

import { shannonEntropy } from './entropy';

describe('shannonEntropy', () => {
  it('is 0 for empty and single-character strings', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaaaa')).toBe(0);
  });

  it('matches hand-computed values', () => {
    expect(shannonEntropy('ab')).toBe(1);
    expect(shannonEntropy('abcd')).toBe(2);
    expect(shannonEntropy('aabb')).toBe(1);
    // p = 3/4 and 1/4.
    expect(shannonEntropy('aaab')).toBeCloseTo(-(0.75 * Math.log2(0.75) + 0.25 * Math.log2(0.25)), 12);
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(shannonEntropy('😀😀')).toBe(0);
    expect(shannonEntropy('😀a')).toBe(1);
  });
});
