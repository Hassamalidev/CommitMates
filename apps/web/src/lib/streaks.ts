import { pairCompanion, pairCompanionState, type CompanionInput, type CompanionState, type StreakStripDay } from '@commitmates/ui';

import { brandCompanion } from './brand';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Length of `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

type PairCompanionData = { seed: number; stage: number; mood: 'happy' | 'neutral' | 'sad' };

/**
 * The pair's companion and how it shows its mood (CLAUDE.md §9.5 "Seeds": both members' palettes). A
 * member without a persona snapshot yet lends the site's own color.
 */
export function pairCompanionView(
  companion: PairCompanionData | null,
  fallbackSeed: number,
  palettes: readonly [string | null, string | null],
  currentStreak: number,
): { companion: CompanionInput; state: CompanionState } {
  const source = companion ?? { seed: fallbackSeed, stage: 0, mood: 'neutral' as const };
  return {
    companion: pairCompanion(
      {
        seed: source.seed,
        stage: source.stage,
        primaryHex: palettes[0] ?? brandCompanion.paletteHex,
        secondaryHex: palettes[1] ?? brandCompanion.paletteHex,
      },
      currentStreak,
    ),
    state: pairCompanionState(source.mood),
  };
}

/**
 * The last `count` days ending yesterday (UTC), oldest first, each with its outcome or null when it
 * was not judged (before the pair, a skipped day, while paused).
 */
export function stripDays(days: readonly { day: string; outcome: StreakStripDay['outcome'] }[], count: number, now: Date): StreakStripDay[] {
  const byDay = new Map(days.map((entry) => [entry.day, entry.outcome]));
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(now.getTime() - (count - index) * DAY_MS).toISOString().slice(0, ISO_DATE_LENGTH);
    return { day, outcome: byDay.get(day) ?? null };
  });
}
