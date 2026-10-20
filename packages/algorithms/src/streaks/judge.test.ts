import { describe, expect, it } from 'vitest';

import { addDays, pairCompanionStage, judgeDay, judgeableAt, localDate, moodAfter, startOfLocalDay, type StreakState } from './judge';

const params = { minDaily: 1, freezeEveryDays: 7, maxFreezes: 2, pauseAfterMissedDays: 3 };
const fresh: StreakState = { currentStreak: 0, longestStreak: 0, freezes: 0, missedInRow: 0 };

describe('local days', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds when a calendar day starts in a timezone, across daylight saving', () => {
    expect(startOfLocalDay('2026-10-20', 'Asia/Kolkata').toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // Midnight does not exist here that day: the day starts at 01:00.
    expect(startOfLocalDay('2026-03-29', 'Asia/Beirut').toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(startOfLocalDay('2026-09-06', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(localDate(new Date('2026-10-20T19:00:00Z'), 'Asia/Karachi')).toBe('2026-10-21');
    expect(localDate(new Date('2026-10-20T19:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-20');
  });

  it('judges a day once both members’ days are over, plus the grace hours', () => {
    // Karachi's 21st begins at 19:00Z on the 20th; Los Angeles' at 07:00Z on the 21st.
    expect(judgeableAt('2026-10-20', ['Asia/Karachi', 'America/Los_Angeles'], 6).toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(judgeableAt('2026-10-20', ['UTC', 'UTC'], 0).toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });
});

describe('judgeDay', () => {
  it('counts a day when both members contributed, and earns a freeze every few counted days', () => {
    const counted = judgeDay({ ...fresh, currentStreak: 6, longestStreak: 6, missedInRow: 1 }, { a: 2, b: 1 }, params);
    expect(counted).toEqual({ outcome: 'counted', state: { currentStreak: 7, longestStreak: 7, freezes: 1, missedInRow: 0 }, paused: false });
    // Freezes are capped.
    expect(judgeDay({ currentStreak: 13, longestStreak: 20, freezes: 2, missedInRow: 0 }, { a: 1, b: 1 }, params).state).toEqual({
      currentStreak: 14,
      longestStreak: 20,
      freezes: 2,
      missedInRow: 0,
    });
  });

  it('uses a freeze before missing, and pauses after misses in a row', () => {
    expect(judgeDay({ ...fresh, currentStreak: 5, longestStreak: 5, freezes: 1 }, { a: 3, b: 0 }, params)).toEqual({
      outcome: 'frozen',
      state: { currentStreak: 5, longestStreak: 5, freezes: 0, missedInRow: 0 },
      paused: false,
    });
    const missed = judgeDay({ ...fresh, currentStreak: 5, longestStreak: 5 }, { a: 0, b: 4 }, params);
    expect(missed).toEqual({ outcome: 'missed', state: { currentStreak: 0, longestStreak: 5, freezes: 0, missedInRow: 1 }, paused: false });
    expect(judgeDay({ ...fresh, missedInRow: 2 }, { a: 0, b: 0 }, params).paused).toBe(true);
  });

  it('sets the companion’s stage and mood', () => {
    expect(pairCompanionStage(0, [3, 7, 14, 30, 60])).toBe(0);
    expect(pairCompanionStage(7, [3, 7, 14, 30, 60])).toBe(2);
    expect(pairCompanionStage(90, [3, 7, 14, 30, 60])).toBe(5);
    expect([moodAfter('counted'), moodAfter('frozen'), moodAfter('missed')]).toEqual(['happy', 'neutral', 'sad']);
  });
});
