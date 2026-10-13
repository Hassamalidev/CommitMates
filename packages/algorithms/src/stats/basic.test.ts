import { describe, expect, it } from 'vitest';

import { clamp, mean } from './basic';

describe('mean', () => {
  it('returns 0 for an empty list', () => {
    expect(mean([])).toBe(0);
  });

  it('averages values', () => {
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
