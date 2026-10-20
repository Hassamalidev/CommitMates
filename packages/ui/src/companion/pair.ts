import { MAX_STAGE, SPECIES_COUNT, type CompanionInput, type CompanionState } from './generate';

export type PairMood = 'happy' | 'neutral' | 'sad';

export type PairCompanionSource = {
  /** The pair companion's seed (a hash of the pair id, CLAUDE.md §9.5 "Seeds"). */
  seed: number;
  /** Stage from the streak; can exceed the drawable stages, which then stay at the last one. */
  stage: number;
  /** Each member's palette color; the second colors the left half's lower third. */
  primaryHex: string;
  secondaryHex: string;
};

/**
 * The two-tone companion a pair shares (CLAUDE.md §8 F13 "UI", §9.5 step 8): seeded by the pair,
 * colored by both members, and as grown as the streak. A streak of any length wears the flame.
 */
export function pairCompanion(source: PairCompanionSource, currentStreak: number): CompanionInput {
  return {
    seed: source.seed,
    species: Math.abs(source.seed) % SPECIES_COUNT,
    paletteHex: source.primaryHex,
    secondaryHex: source.secondaryHex,
    stage: Math.min(MAX_STAGE, Math.max(0, source.stage)),
    traits: currentStreak > 0 ? ['streak'] : [],
  };
}

/** How the companion shows its mood: a hop after a counted day, rest after a frozen one, a slump after a miss. */
export function pairCompanionState(mood: PairMood): CompanionState {
  return mood === 'happy' ? 'done' : mood === 'neutral' ? 'idle' : 'error';
}
