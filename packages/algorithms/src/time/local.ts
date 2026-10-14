/**
 * Local clock readings in an IANA timezone.
 * Formula: hour and weekday of an instant as a wall clock in the zone shows them,
 *          including daylight-saving shifts (from the runtime's timezone database).
 * Settings: none
 * Spec: CLAUDE.md §8 F1 steps 1–3, §10.9
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', weekday: 'short' });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

// allowed-literal: weekday abbreviations of the en-US locale, in Date#getUTCDay order
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** True when the runtime knows the timezone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export type LocalClock = {
  /** 0–23. */
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

/** The hour and weekday a wall clock in `timeZone` shows at `instant`. Throws `RangeError` for an unknown zone. */
export function localClock(instant: Date, timeZone: string): LocalClock {
  let hour = 0;
  let weekday = 0;
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'weekday') weekday = Math.max(0, WEEKDAYS.indexOf(part.value));
  }
  return { hour, weekday };
}

/** Day of the week (0 = Sunday … 6 = Saturday) of a calendar date written `YYYY-MM-DD`. */
export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
