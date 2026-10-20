import { describe, expect, it } from 'vitest';

import { mulberry32, seedFrom, shuffled } from './random';

describe('seeded randomness', () => {
  it('repeats exactly for the same seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it('turns text into stable seeds and shuffles without losing items', () => {
    expect(seedFrom('2026-10-14:uni')).toBe(seedFrom('2026-10-14:uni'));
    expect(seedFrom('2026-10-14:uni')).not.toBe(seedFrom('2026-10-15:uni'));
    const items = ['a', 'b', 'c', 'd', 'e'];
    const once = shuffled(items, mulberry32(7));
    expect([...once].sort()).toEqual(items);
    expect(shuffled(items, mulberry32(7))).toEqual(once);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
