import { describe, expect, it } from 'vitest';

import { bm25Index, bm25Scores, bm25Tokens } from './bm25';

const parameters = { k1: 1.2, b: 0.75 };

describe('bm25Tokens', () => {
  it('lowercases words and drops stopwords and punctuation', () => {
    expect(bm25Tokens('The Face-Recognition app, for students!', new Set(['the', 'for']))).toEqual(['face', 'recognition', 'app', 'students']);
  });
});

describe('bm25Scores', () => {
  const documents = [['face', 'recognition', 'attendance'], ['attendance', 'system'], ['campus', 'map', 'map', 'map']];
  const index = bm25Index(documents);

  it('matches hand-computed values', () => {
    // N = 3, avgdl = 3; "face" appears in 1 document: idf = ln(1 + 2.5 / 1.5).
    const idfFace = Math.log(1 + 2.5 / 1.5);
    const expected = (idfFace * 1 * 2.2) / (1 + 1.2 * (1 - 0.75 + 0.75 * (3 / 3)));
    const [first, second, third] = bm25Scores(index, ['face'], parameters);
    expect(first).toBeCloseTo(expected, 12);
    expect(second).toBe(0);
    expect(third).toBe(0);
  });

  it('rewards repeated terms with saturation and shorter documents', () => {
    const scores = bm25Scores(index, ['map'], parameters);
    const idfMap = Math.log(1 + 2.5 / 1.5);
    const norm = 1 - 0.75 + 0.75 * (4 / 3);
    expect(scores[2]).toBeCloseTo((idfMap * 3 * 2.2) / (3 + 1.2 * norm), 12);
    const attendance = bm25Scores(index, ['attendance'], parameters);
    // The two-word document is shorter than average, so it scores higher.
    expect(attendance[1]).toBeGreaterThan(attendance[0] ?? 0);
  });

  it('adds up query terms and counts repeats in the query', () => {
    const one = bm25Scores(index, ['face'], parameters)[0] ?? 0;
    const two = bm25Scores(index, ['face', 'face'], parameters)[0] ?? 0;
    expect(two).toBeCloseTo(2 * one, 12);
  });

  it('copes with an empty corpus or query', () => {
    expect(bm25Scores(bm25Index([]), ['x'], parameters)).toEqual([]);
    expect(bm25Scores(index, [], parameters)).toEqual([0, 0, 0]);
    expect(bm25Scores(bm25Index([[]]), ['x'], parameters)).toEqual([0]);
  });
});
