/**
 * Shared streak judgement.
 * Formula:
 *   judgeable(D) = max over both members of (local start of D+1 in their timezone) + graceHours
 *   counted  when both counts ≥ minDaily: streak + 1, longest = max, a freeze every
 *            `freezeEveryDays` counted days (at most `maxFreezes`), misses in a row reset
 *   frozen   otherwise when a freeze is held: streak kept, one freeze used
 *   missed   otherwise: streak 0, misses in a row + 1; paused at `pauseAfterMissedDays`
 *   stage    = number of `companionStageDays` thresholds reached by the streak
 *   mood     = happy after counted, neutral after frozen, sad after missed
 * Settings: streaks.minDailyContributions, streaks.graceHours, streaks.freezeEveryDays,
 *           streaks.maxFreezes, streaks.pauseAfterMissedDays, streaks.companionStageDays (passed in)
 * Spec: CLAUDE.md §8 F13 "Daily judgement"
 */

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * MS_PER_HOUR; // allowed-literal: unit conversion
const MS_PER_SECOND = 1000; // allowed-literal: unit conversion

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = wallFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    wallFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of wallFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  // The wall clock has whole seconds; compare it with the instant truncated the same way.
  return wall - Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND;
}

/** `YYYY-MM-DD` plus `days`. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10); // allowed-literal: length of YYYY-MM-DD
}

/** The calendar date `instant` falls on in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  return new Date(instant.getTime() + zoneOffset(instant.getTime(), timeZone)).toISOString().slice(0, 10); // allowed-literal: length of YYYY-MM-DD
}

/**
 * The instant the calendar date `day` begins in `timeZone`. Candidates use the zone's offset half a
 * day before and after wall-clock midnight; the earliest one that falls on `day` wins, so a
 * daylight-saving change that skips midnight starts the day at the first time that exists, and one
 * that repeats midnight starts it at the first of the two.
 */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const wallMidnight = Date.parse(`${day}T00:00:00Z`);
  const halfDay = MS_PER_DAY / 2; // allowed-literal: half of a day
  const candidates = [zoneOffset(wallMidnight - halfDay, timeZone), zoneOffset(wallMidnight + halfDay, timeZone)]
    .map((offset) => wallMidnight - offset)
    .sort((a, b) => a - b);
  const onDay = candidates.find((candidate) => localDate(new Date(candidate), timeZone) === day);
  return new Date(onDay ?? wallMidnight - zoneOffset(wallMidnight, timeZone));
}

/** When day `day` can be judged: both members' local days are over, plus the grace hours. */
export function judgeableAt(day: string, timeZones: readonly string[], graceHours: number): Date {
  const next = addDays(day, 1);
  const ends = timeZones.map((zone) => startOfLocalDay(next, zone).getTime());
  return new Date(Math.max(...ends) + graceHours * MS_PER_HOUR);
}

export type StreakState = { currentStreak: number; longestStreak: number; freezes: number; missedInRow: number };
export type StreakParams = { minDaily: number; freezeEveryDays: number; maxFreezes: number; pauseAfterMissedDays: number };
export type DayOutcome = 'counted' | 'frozen' | 'missed';

/** One day's outcome and the pair's state after it. */
export function judgeDay(
  state: StreakState,
  counts: { a: number; b: number },
  params: StreakParams,
): { outcome: DayOutcome; state: StreakState; paused: boolean } {
  if (counts.a >= params.minDaily && counts.b >= params.minDaily) {
    const currentStreak = state.currentStreak + 1;
    const earned = params.freezeEveryDays > 0 && currentStreak % params.freezeEveryDays === 0;
    return {
      outcome: 'counted',
      state: {
        currentStreak,
        longestStreak: Math.max(state.longestStreak, currentStreak),
        freezes: earned ? Math.min(params.maxFreezes, state.freezes + 1) : state.freezes,
        missedInRow: 0,
      },
      paused: false,
    };
  }
  if (state.freezes > 0) {
    return { outcome: 'frozen', state: { ...state, freezes: state.freezes - 1 }, paused: false };
  }
  const missedInRow = state.missedInRow + 1;
  return {
    outcome: 'missed',
    state: { ...state, currentStreak: 0, missedInRow },
    paused: params.pauseAfterMissedDays > 0 && missedInRow >= params.pauseAfterMissedDays,
  };
}

/** How many stage thresholds the streak has reached. */
export function pairCompanionStage(currentStreak: number, stageDays: readonly number[]): number {
  return stageDays.filter((days) => currentStreak >= days).length;
}

export type CompanionMood = 'happy' | 'neutral' | 'sad';

export function moodAfter(outcome: DayOutcome): CompanionMood {
  return outcome === 'counted' ? 'happy' : outcome === 'frozen' ? 'neutral' : 'sad';
}
