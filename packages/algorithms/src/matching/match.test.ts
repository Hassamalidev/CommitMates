import { describe, expect, it } from 'vitest';

import { mulberry32, shuffled } from '../stats/random';

import {
  buildDecks,
  complementarity,
  explainMatch,
  matchComponents,
  maxNormalize,
  modeScore,
  sharesSignal,
  universityGaps,
  type MatchProfile,
  type ModeWeights,
} from './match';

const profile = (id: string, vector: Record<string, number>, rest: Partial<MatchProfile> = {}): MatchProfile => ({
  id,
  vector,
  topTags: Object.keys(vector),
  interests: [],
  goals: [],
  ...rest,
});

const weights: Record<'study' | 'teammate' | 'explore', ModeWeights> = {
  study: { sim: 0.6, int: 0.3, comp: 0.1 },
  teammate: { sim: 0.2, int: 0.2, comp: 0.6 },
  explore: { sim: 0.34, int: 0.33, comp: 0.33 },
};

describe('components', () => {
  it('computes similarity, interest overlap and goal coverage by hand', () => {
    const user = profile('u', { react: 0.6, python: 0.8 }, { interests: ['ml', 'web'], goals: ['docker', 'react'] });
    const candidate = profile('c', { react: 0.8, docker: 0.4 }, { interests: ['web', 'games'] });
    const components = matchComponents(user, candidate);
    // cosine = 0.48 / (1 × 0.894427) = 0.536656
    expect(components.sim).toBeCloseTo(0.536656, 5);
    // jaccard = |{web}| / |{ml, web, games}| = 1/3
    expect(components.int).toBeCloseTo(1 / 3, 6);
    // candidate normalized by max 0.8: react 1, docker 0.5 → (0.5 + 1) / 2 = 0.75
    expect(components.comp).toBeCloseTo(0.75, 6);
    expect(modeScore(components, weights.teammate)).toBeCloseTo(0.2 * 0.536656 + 0.2 / 3 + 0.6 * 0.75, 5);
  });

  it('gives no complementarity without goals, and uses university gaps in their place', () => {
    expect(complementarity([], { react: 1 })).toBe(0);
    expect(complementarity(['go'], {})).toBe(0);
    expect(universityGaps(['react', 'docker', 'python', 'go'], ['react', 'python'])).toEqual(['docker', 'go']);
    expect(maxNormalize({ a: 2, b: 1 })).toEqual({ a: 1, b: 0.5 });
    expect(maxNormalize({})).toEqual({});
  });

  it('scores only pairs that share a tag, an interest or a covered goal', () => {
    expect(sharesSignal(profile('u', { go: 1 }), profile('c', { rust: 1 }))).toBe(false);
    expect(sharesSignal(profile('u', { go: 1 }), profile('c', { go: 0.1 }))).toBe(true);
    expect(sharesSignal(profile('u', {}, { interests: ['ml'] }), profile('c', {}, { interests: ['ml'] }))).toBe(true);
    expect(sharesSignal(profile('u', {}, { goals: ['rust'] }), profile('c', { rust: 0.2 }))).toBe(true);
  });

  it('explains a match with shared tags, goals the candidate covers and shared interests', () => {
    const user = profile('u', { react: 1, docker: 0.5 }, { topTags: ['react', 'docker'], interests: ['web', 'ml'], goals: ['rust', 'go', 'kotlin'] });
    const candidate = profile('c', { react: 1, rust: 0.4, go: 0.9 }, { topTags: ['react', 'go', 'rust'], interests: ['web'] });
    expect(explainMatch(user, candidate)).toEqual({ sharedTags: ['react'], coverage: ['go', 'rust'], sharedInterests: 1 });
  });
});

describe('buildDecks', () => {
  const base = { weights, deckSize: 10, maxImpressions: 10, excluded: () => false };

  it('ranks by the mode: study favours similar people, teammate favours complementary ones', () => {
    const user = profile('u', { react: 1 }, { goals: ['ml'] });
    const twin = profile('twin', { react: 1 });
    const mentor = profile('mentor', { react: 0.2, ml: 1 });
    const decks = buildDecks({ ...base, order: [user, twin, mentor] });
    const first = (mode: string) => decks.find((entry) => entry.userId === 'u' && entry.mode === mode)?.candidateId;
    expect(first('study')).toBe('twin');
    expect(first('teammate')).toBe('mentor');
  });

  it('shows a candidate to a member in one mode per day only, and never the member themself', () => {
    const members = ['a', 'b', 'c'].map((id) => profile(id, { react: 1 }));
    const decks = buildDecks({ ...base, order: members });
    for (const member of members) {
      const candidates = decks.filter((entry) => entry.userId === member.id).map((entry) => entry.candidateId);
      expect(new Set(candidates).size).toBe(candidates.length);
      expect(candidates).not.toContain(member.id);
    }
  });

  it('caps how many times one person is shown per day across all decks', () => {
    const popular = profile('star', { react: 1, go: 1 });
    const others = Array.from({ length: 6 }, (_, index) => profile(`m${index}`, { react: 1 }));
    const decks = buildDecks({ ...base, maxImpressions: 2, order: [...others, popular] });
    expect(decks.filter((entry) => entry.candidateId === 'star')).toHaveLength(2);
  });

  it('respects exclusions and the deck size', () => {
    const members = Array.from({ length: 5 }, (_, index) => profile(`m${index}`, { react: 1 }));
    const decks = buildDecks({ ...base, deckSize: 1, order: members, excluded: (user, candidate) => user === 'm0' && candidate === 'm1' });
    expect(decks.some((entry) => entry.userId === 'm0' && entry.candidateId === 'm1')).toBe(false);
    for (const mode of ['study', 'teammate', 'explore']) {
      expect(decks.filter((entry) => entry.userId === 'm0' && entry.mode === mode).length).toBeLessThanOrEqual(1);
    }
  });

  it('gives the scarce slots to different people on different days through the seeded order', () => {
    const star = profile('star', { react: 1 });
    const fans = Array.from({ length: 8 }, (_, index) => profile(`f${index}`, { react: 1 }));
    const firstServed = (seed: number) => {
      const order = shuffled([...fans, star], mulberry32(seed));
      return buildDecks({ ...base, maxImpressions: 1, order })
        .filter((entry) => entry.candidateId === 'star')
        .map((entry) => entry.userId);
    };
    expect(firstServed(1)).toEqual(firstServed(1));
    const winners = new Set([1, 2, 3, 4, 5, 6].flatMap(firstServed));
    expect(winners.size).toBeGreaterThan(1);
  });
});
