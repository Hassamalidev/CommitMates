import { describe, expect, it } from 'vitest';

import { isValidTimeZone, localClock, weekdayOfDate } from './local';

describe('localClock', () => {
  it('reads the wall clock of the zone', () => {
    expect(localClock(new Date('2026-10-14T12:00:00Z'), 'UTC')).toEqual({ hour: 12, weekday: 3 });
    // +05:00 pushes a late-evening instant into the next day.
    expect(localClock(new Date('2026-10-14T20:30:00Z'), 'Asia/Karachi')).toEqual({ hour: 1, weekday: 4 });
    // −07:00 pulls an early-morning instant into the previous day.
    expect(localClock(new Date('2026-10-14T03:00:00Z'), 'America/Los_Angeles')).toEqual({ hour: 20, weekday: 2 });
  });

  it('reports midnight as hour 0, not 24', () => {
    expect(localClock(new Date('2026-10-14T00:00:00Z'), 'UTC').hour).toBe(0);
    expect(localClock(new Date('2026-10-14T19:00:00Z'), 'Asia/Karachi').hour).toBe(0);
  });

  it('follows daylight-saving shifts', () => {
    // New York springs forward on 2026-03-08: 01:30 EST is followed by 03:30 EDT.
    expect(localClock(new Date('2026-03-08T06:30:00Z'), 'America/New_York').hour).toBe(1);
    expect(localClock(new Date('2026-03-08T07:30:00Z'), 'America/New_York').hour).toBe(3);
    // And falls back on 2026-11-01: 01:30 happens twice.
    expect(localClock(new Date('2026-11-01T05:30:00Z'), 'America/New_York').hour).toBe(1);
    expect(localClock(new Date('2026-11-01T06:30:00Z'), 'America/New_York').hour).toBe(1);
  });

  it('throws for an unknown zone', () => {
    expect(() => localClock(new Date('2026-10-14T00:00:00Z'), 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('isValidTimeZone', () => {
  it('recognizes IANA names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('weekdayOfDate', () => {
  it('gives the weekday of a calendar date', () => {
    expect(weekdayOfDate('2026-10-14')).toBe(3);
    expect(weekdayOfDate('2026-10-10')).toBe(6);
    expect(weekdayOfDate('2026-10-11')).toBe(0);
  });
});
