import { describe, expect, it } from 'vitest';

import { cosine, histogramIntersection, jaccard } from '../similarity/similarity';

import {
  compatBand,
  compatComponents,
  compatExplanations,
  compatScore,
  sharedActiveWindow,
  skillVector,
  type CompatSide,
} from './compat';

const hours = (entries: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => entries[hour] ?? 0);

const alice: CompatSide = {
  languages: [
    { name: 'TypeScript', share: 0.8 },
    { name: 'CSS', share: 0.2 },
  ],
  tags: [
    { tag: 'react', weight: 1 },
    { tag: 'postgres', weight: 0.5 },
  ],
  topics: ['react', 'maps', 'web'],
  hourHistUtc: hours({ 20: 0.5, 21: 0.25, 22: 0.25 }),
  starred: ['vercel/next.js', 'facebook/react', 'a/b'],
};

const bob: CompatSide = {
  languages: [{ name: 'TypeScript', share: 1 }],
  tags: [
    { tag: 'react', weight: 0.5 },
    { tag: 'docker', weight: 1 },
  ],
  topics: ['react', 'devops'],
  hourHistUtc: hours({ 21: 0.5, 22: 0.5 }),
  starred: ['facebook/react', 'vercel/next.js', 'x/y'],
};

describe('similarity measures', () => {
  it('computes cosine on sparse vectors', () => {
    expect(cosine({ x: 1, y: 0 }, { x: 1 })).toBeCloseTo(1, 12);
    expect(cosine({ x: 1 }, { y: 1 })).toBe(0);
    expect(cosine({ x: 3, y: 4 }, { x: 4, y: 3 })).toBeCloseTo(24 / 25, 12);
    expect(cosine({}, { x: 1 })).toBe(0);
    expect(cosine({ x: 0 }, { x: 1 })).toBe(0);
  });

  it('computes Jaccard on sets', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
    expect(jaccard(['a', 'a'], ['a'])).toBe(1);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a'], [])).toBe(0);
  });

  it('computes histogram intersection', () => {
    expect(histogramIntersection([0.5, 0.5, 0], [0.25, 0.25, 0.5])).toBe(0.5);
    expect(histogramIntersection([1, 0], [1, 0])).toBe(1);
    expect(histogramIntersection([1, 0], [0, 1])).toBe(0);
    expect(histogramIntersection([1], [])).toBe(0);
  });
});

describe('compatComponents', () => {
  it('matches hand-computed values', () => {
    const components = compatComponents(alice, bob);
    // Vectors: A = {TS .8, CSS .2, react 1, postgres .5}, B = {TS 1, react .5, docker 1}.
    const dot = 0.8 * 1 + 1 * 0.5;
    const normA = Math.sqrt(0.64 + 0.04 + 1 + 0.25);
    const normB = Math.sqrt(1 + 0.25 + 1);
    expect(components.skill).toBeCloseTo(dot / (normA * normB), 12);
    // {react, maps, web} vs {react, devops}: 1 shared of 4.
    expect(components.interest).toBe(0.25);
    // min(.25, .5) + min(.25, .5) at hours 21 and 22.
    expect(components.rhythm).toBe(0.5);
    // Tags react, postgres, docker: |1 − .5| + |.5 − 0| + |0 − 1| = 2, over 3.
    expect(components.complement).toBeCloseTo(2 / 3, 12);
  });

  it('marks components that cannot be computed', () => {
    const empty: CompatSide = { languages: [], tags: [], topics: [], hourHistUtc: hours({}), starred: [] };
    expect(compatComponents(alice, empty)).toEqual({ skill: null, interest: null, rhythm: null, complement: null });
    const noTags = { ...bob, tags: [] };
    const components = compatComponents(alice, noTags);
    expect(components.skill).not.toBeNull();
    expect(components.complement).toBeNull();
  });

  it('is symmetric', () => {
    const ab = compatComponents(alice, bob);
    const ba = compatComponents(bob, alice);
    for (const key of ['skill', 'interest', 'rhythm', 'complement'] as const) expect(ba[key]).toBeCloseTo(ab[key] ?? -1, 12);
  });

  it('compares only the top ten tags of each person', () => {
    const many = (prefix: string) => Array.from({ length: 15 }, (_, index) => ({ tag: `${prefix}${index}`, weight: 1 - index / 20 }));
    const left = { ...alice, tags: many('a') };
    const right = { ...bob, tags: many('b') };
    // Twenty tags, none shared: every one differs by its own weight.
    const expected = (left.tags.slice(0, 10).reduce((t, x) => t + x.weight, 0) * 2) / 20;
    expect(compatComponents(left, right).complement).toBeCloseTo(expected, 12);
  });
});

describe('skillVector', () => {
  it('keeps languages and tags apart', () => {
    expect(skillVector({ languages: [{ name: 'Go', share: 1 }], tags: [{ tag: 'go', weight: 0.5 }] })).toEqual({
      'lang:Go': 1,
      'tag:go': 0.5,
    });
  });
});

describe('compatScore and compatBand', () => {
  const weights = { skill: 0.3, interest: 0.25, rhythm: 0.2, complement: 0.25 };
  const bands = [
    { min: 0, key: 'different-worlds' },
    { min: 40, key: 'good-pair' },
    { min: 65, key: 'strong-pair' },
    { min: 85, key: 'dream-team' },
  ];

  it('weights the components', () => {
    expect(compatScore({ skill: 1, interest: 1, rhythm: 1, complement: 1 }, weights)).toBe(100);
    expect(compatScore({ skill: 0.5, interest: 0.4, rhythm: 0.2, complement: 0.6 }, weights)).toBe(44);
    expect(compatScore({ skill: 0, interest: 0, rhythm: 0, complement: 0 }, weights)).toBe(0);
  });

  it('re-normalizes the weights over the components that exist', () => {
    // Only skill (0.3) and rhythm (0.2): (0.3·1 + 0.2·0) / 0.5 = 0.6.
    expect(compatScore({ skill: 1, interest: null, rhythm: 0, complement: null }, weights)).toBe(60);
    expect(compatScore({ skill: null, interest: null, rhythm: null, complement: null }, weights)).toBeNull();
    expect(compatScore({ skill: 1, interest: 1, rhythm: 1, complement: 1 }, { skill: 0, interest: 0, rhythm: 0, complement: 0 })).toBeNull();
  });

  it('picks the highest band reached, in any order', () => {
    expect(compatBand(0, bands)).toBe('different-worlds');
    expect(compatBand(39, bands)).toBe('different-worlds');
    expect(compatBand(40, bands)).toBe('good-pair');
    expect(compatBand(84, bands)).toBe('strong-pair');
    expect(compatBand(100, [...bands].reverse())).toBe('dream-team');
    expect(compatBand(5, [{ min: 10, key: 'x' }])).toBeNull();
  });
});

describe('sharedActiveWindow', () => {
  it('finds the longest run where both are above their own median', () => {
    expect(sharedActiveWindow(alice.hourHistUtc, bob.hourHistUtc)).toEqual({ startHourUtc: 21, hours: 2 });
  });

  it('wraps past midnight', () => {
    const a = hours({ 23: 0.5, 0: 0.25, 1: 0.25 });
    const b = hours({ 22: 0.2, 23: 0.4, 0: 0.4 });
    expect(sharedActiveWindow(a, b)).toEqual({ startHourUtc: 23, hours: 2 });
  });

  it('is null without any shared hour, and the whole day when every hour qualifies', () => {
    expect(sharedActiveWindow(hours({ 3: 1 }), hours({ 15: 1 }))).toBeNull();
    expect(sharedActiveWindow(hours({}), hours({}))).toBeNull();
    expect(sharedActiveWindow([], [])).toBeNull();
    const ramp = Array.from({ length: 24 }, (_, hour) => hour + 1);
    // Half the hours sit above the median of a ramp; the other person is flat-out everywhere.
    expect(sharedActiveWindow(ramp, ramp)).toEqual({ startHourUtc: 12, hours: 12 });
  });
});

describe('compatExplanations', () => {
  it('lists real shared signals and one strength each', () => {
    expect(compatExplanations(alice, bob)).toEqual({
      sharedTags: ['react'],
      sharedStars: ['vercel/next.js', 'facebook/react'],
      window: { startHourUtc: 21, hours: 2 },
      strengthA: 'postgres',
      strengthB: 'docker',
    });
  });

  it('keeps at most three of each and copes with nothing in common', () => {
    const tags = ['a', 'b', 'c', 'd'].map((tag, index) => ({ tag, weight: 1 - index / 10 }));
    const stars = ['r1', 'r2', 'r3', 'r4'];
    const same = { ...alice, tags, starred: stars };
    const explained = compatExplanations(same, same);
    expect(explained.sharedTags).toEqual(['a', 'b', 'c']);
    expect(explained.sharedStars).toEqual(['r1', 'r2', 'r3']);
    expect(explained.strengthA).toBeNull();

    const apart = compatExplanations({ ...alice, starred: [] }, { ...bob, tags: [{ tag: 'zig', weight: 1 }] });
    expect(apart.sharedTags).toEqual([]);
    expect(apart.sharedStars).toEqual([]);
  });
});
