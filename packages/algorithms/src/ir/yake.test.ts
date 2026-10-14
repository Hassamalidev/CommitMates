import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { levenshteinSimilarity, splitSentences, tokenize, wordTag, yake, type Keyphrase } from './yake';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../__fixtures__/${path}`, import.meta.url), 'utf8'));

const stopwords = new Set(read('stopwords/en.json') as string[]);
const reference = read('yake/reference.json') as {
  options: { ngramMax: number; top: number; dedupThreshold: number };
  cases: { id: string; text: string; reference: Keyphrase[] }[];
};

/**
 * The port follows the reference's scoring exactly, but splits sentences and words with
 * simple rules instead of the reference's tokenizer library. The tolerance below is what
 * that difference costs on these texts: most of the reference's keyphrases are found, the
 * best few agree, and shared keyphrases score within a fifth of the reference.
 */
const MIN_SHARED_OF_TOP = 8;
const TOP_AGREEMENT = 3;
const SCORE_TOLERANCE = 0.2;

describe('yake against the reference implementation', () => {
  for (const testCase of reference.cases) {
    it(`extracts the same keyphrases from "${testCase.id}"`, () => {
      const ours = yake(testCase.text, { stopwords, ...reference.options });
      const ourScores = new Map(ours.map((entry) => [entry.keyphrase.toLowerCase(), entry.score]));
      const shared = testCase.reference.filter((entry) => ourScores.has(entry.keyphrase.toLowerCase()));

      expect(shared.length, JSON.stringify({ ours, reference: testCase.reference })).toBeGreaterThanOrEqual(MIN_SHARED_OF_TOP);
      expect(ours.slice(0, TOP_AGREEMENT).map((entry) => entry.keyphrase.toLowerCase())).toEqual(
        testCase.reference.slice(0, TOP_AGREEMENT).map((entry) => entry.keyphrase.toLowerCase()),
      );
      for (const entry of shared) {
        const ourScore = ourScores.get(entry.keyphrase.toLowerCase()) ?? Number.NaN;
        expect(Math.abs(ourScore - entry.score) / entry.score, entry.keyphrase).toBeLessThanOrEqual(SCORE_TOLERANCE);
      }
    });
  }
});

describe('yake building blocks', () => {
  it('tags words as the reference does', () => {
    expect(wordTag('2026', 0)).toBe('d');
    expect(wordTag('1,000.5', 3)).toBe('d');
    expect(wordTag('COVID19', 1)).toBe('u');
    expect(wordTag('NASA', 2)).toBe('a');
    expect(wordTag('Lahore', 2)).toBe('n');
    expect(wordTag('Lahore', 0)).toBe('p');
    expect(wordTag('a--b', 1)).toBe('u');
    expect(wordTag('react', 1)).toBe('p');
  });

  it('splits sentences and words, dropping clitics', () => {
    expect(splitSentences('One sentence. Another one!\n\nA new block')).toEqual(['One sentence.', 'Another one!', 'A new block']);
    expect(tokenize("Don't break the student's state-of-the-art app.")).toEqual(['Do', "n't", 'break', 'the', 'student', 'state-of-the-art', 'app', '.']);
  });

  it('measures normalized Levenshtein similarity', () => {
    expect(levenshteinSimilarity('face recognition', 'face recognition')).toBe(1);
    expect(levenshteinSimilarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 12);
    expect(levenshteinSimilarity('', '')).toBe(1);
    expect(levenshteinSimilarity('abc', '')).toBe(0);
  });

  it('returns nothing for empty text or text of stopwords only', () => {
    expect(yake('', { stopwords, ngramMax: 3, top: 10, dedupThreshold: 0.8 })).toEqual([]);
    expect(yake('the and of', { stopwords, ngramMax: 3, top: 10, dedupThreshold: 0.8 })).toEqual([]);
  });

  it('keeps at most `top` keyphrases and drops near-duplicates', () => {
    const text = reference.cases[0]?.text ?? '';
    const three = yake(text, { stopwords, ngramMax: 3, top: 3, dedupThreshold: 0.8 });
    expect(three).toHaveLength(3);
    const all = yake(text, { stopwords, ngramMax: 3, top: 50, dedupThreshold: 0.8 });
    for (const [index, a] of all.entries()) {
      for (const b of all.slice(index + 1)) expect(levenshteinSimilarity(a.keyphrase.toLowerCase(), b.keyphrase.toLowerCase())).toBeLessThanOrEqual(0.8);
    }
  });
});
