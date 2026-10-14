import { describe, expect, it } from 'vitest';

import { mergeExpansion, normalizeTerm, sampleFrequencies, scoreCandidates } from './taxonomy';

describe('normalizeTerm', () => {
  it('lowercases, trims and makes a slug', () => {
    expect(normalizeTerm('  Computer   Vision ')).toEqual({ term: 'computer vision', slug: 'computer-vision' });
    expect(normalizeTerm('ML')).toEqual({ term: 'ml', slug: 'ml' });
  });

  it('rejects terms shorter than two characters', () => {
    expect(normalizeTerm('a')).toBeNull();
    expect(normalizeTerm('   ')).toBeNull();
  });
});

describe('sampleFrequencies', () => {
  it('counts each value once per sample', () => {
    const frequencies = sampleFrequencies([['opencv', 'python', 'opencv'], ['opencv'], [], ['pytorch']]);
    expect(frequencies.get('opencv')).toBe(0.5);
    expect(frequencies.get('python')).toBe(0.25);
    expect(sampleFrequencies([]).size).toBe(0);
  });
});

describe('scoreCandidates', () => {
  const options = { minSampleFreq: 0.05, maxExpansions: 15 };

  it('rewards values that are frequent in the sample but rare overall', () => {
    const items = scoreCandidates(
      [
        { kind: 'topic', value: 'opencv', sampleFreq: 0.4, globalCount: 1000 },
        { kind: 'topic', value: 'python', sampleFreq: 0.6, globalCount: 100_000 },
      ],
      options,
    );
    expect(items.map((item) => item.value)).toEqual(['opencv', 'python']);
    expect(items[0]?.score).toBeCloseTo(0.4 * Math.log(1 + 100), 12);
    expect(items[1]?.score).toBeCloseTo(0.6 * Math.log(2), 12);
    expect(items.every((item) => item.source === 'cooccurrence')).toBe(true);
  });

  it('scores on sample frequency alone without a global count, and per kind', () => {
    const items = scoreCandidates(
      [
        { kind: 'dependency', value: 'torch', sampleFreq: 0.3, globalCount: null },
        { kind: 'topic', value: 'vision', sampleFreq: 0.2, globalCount: 50 },
      ],
      options,
    );
    expect(items.find((item) => item.value === 'torch')?.score).toBe(0.3);
    // The only topic is its own maximum: log(1 + 1).
    expect(items.find((item) => item.value === 'vision')?.score).toBeCloseTo(0.2 * Math.log(2), 12);
  });

  it('drops rare values and keeps the top N', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({ kind: 'topic' as const, value: `t${index}`, sampleFreq: 0.5 - index / 100, globalCount: null }));
    expect(scoreCandidates([...candidates, { kind: 'topic', value: 'rare', sampleFreq: 0.01, globalCount: null }], options)).toHaveLength(15);
    expect(scoreCandidates([{ kind: 'topic', value: 'rare', sampleFreq: 0.01, globalCount: 5 }], options)).toEqual([]);
    expect(scoreCandidates([{ kind: 'topic', value: 'zero', sampleFreq: 0.5, globalCount: 0 }], options)[0]?.score).toBe(0.5);
  });
});

describe('mergeExpansion', () => {
  it('puts seeds first and drops duplicates', () => {
    const merged = mergeExpansion(
      [{ kind: 'topic', value: 'computer-vision', score: 1, source: 'alias' }],
      [
        { kind: 'topic', value: 'computer-vision', score: 3, source: 'cooccurrence' },
        { kind: 'dependency', value: 'computer-vision', score: 0.2, source: 'cooccurrence' },
      ],
    );
    expect(merged.map((item) => `${item.kind}:${item.source}`)).toEqual(['topic:alias', 'dependency:cooccurrence']);
  });
});
