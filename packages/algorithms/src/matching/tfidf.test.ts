import { describe, expect, it } from 'vitest';

import { l2Normalize, mergeMax, tfidfVectors, topTags } from './tfidf';

describe('tfidfVectors', () => {
  it('matches a hand-computed university of three members', () => {
    // N = 3; df(react) = 2, df(docker) = 1, df(python) = 2.
    // idf: react = python = ln(2.5) = 0.916291; docker = ln(4) = 1.386294.
    const vectors = tfidfVectors(
      new Map([
        ['a', { react: 1, docker: 0.5 }],
        ['b', { react: 0.8, python: 1 }],
        ['c', { python: 0.6 }],
      ]),
    );
    // a: (0.916291, 0.693147) / 1.148932
    expect(vectors.get('a')?.react).toBeCloseTo(0.797515, 5);
    expect(vectors.get('a')?.docker).toBeCloseTo(0.603293, 5);
    // b: (0.733033, 0.916291) / 1.173425
    expect(vectors.get('b')?.react).toBeCloseTo(0.624694, 5);
    expect(vectors.get('b')?.python).toBeCloseTo(0.780869, 5);
    // c has one tag, so it becomes the unit vector.
    expect(vectors.get('c')).toEqual({ python: 1 });
  });

  it('weights a skill everyone has less than a rare one', () => {
    const vectors = tfidfVectors(
      new Map([
        ['a', { git: 1, rust: 1 }],
        ['b', { git: 1 }],
        ['c', { git: 1 }],
      ]),
    );
    const a = vectors.get('a') ?? {};
    expect(a.rust).toBeGreaterThan(a.git ?? 0);
  });

  it('handles empty bases and zero weights', () => {
    expect(tfidfVectors(new Map([['a', {}]])).get('a')).toEqual({});
    expect(tfidfVectors(new Map([['a', { x: 0 }]])).get('a')).toEqual({});
    expect(tfidfVectors(new Map()).size).toBe(0);
  });
});

describe('helpers', () => {
  it('normalizes, ranks and merges', () => {
    expect(l2Normalize({ a: 3, b: 4 })).toEqual({ a: 0.6, b: 0.8 });
    expect(l2Normalize({})).toEqual({});
    expect(topTags({ b: 0.5, a: 0.5, c: 0.9, d: 0 }, 2)).toEqual(['c', 'a']);
    expect(mergeMax([['react', 0.4], ['react', 0.7], ['go', 0.2], ['go', 0.1]])).toEqual({ react: 0.7, go: 0.2 });
  });
});
