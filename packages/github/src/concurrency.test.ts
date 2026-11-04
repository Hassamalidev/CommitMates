import { describe, expect, it } from 'vitest';

import { batches, mapConcurrent } from './concurrency';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapConcurrent', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrent([5, 1, 4, 2, 3, 6, 7], 3, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      for (let i = 0; i < value; i += 1) await tick();
      running -= 1;
      return value * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBe(3);
  });

  it('runs one at a time with a limit of 1, and handles an empty list', async () => {
    const order: number[] = [];
    await mapConcurrent([1, 2, 3], 1, async (value) => {
      order.push(value);
      await tick();
    });
    expect(order).toEqual([1, 2, 3]);
    expect(await mapConcurrent([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it('starts nothing new after a failure and throws it once running tasks settle', async () => {
    const started: number[] = [];
    let settled = 0;
    const run = mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (value) => {
      started.push(value);
      await tick();
      settled += 1;
      if (value === 2) throw new Error('boom');
      return value;
    });
    await expect(run).rejects.toThrow('boom');
    expect(started).toEqual([1, 2, 3]);
    expect(settled).toBe(started.length);
  });
});

describe('batches', () => {
  it('splits into consecutive groups', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 3)).toEqual([]);
    expect(batches([1], 0)).toEqual([[1]]);
  });
});
