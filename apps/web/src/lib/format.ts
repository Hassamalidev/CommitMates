/** `2026-10-14 12:00` — compact UTC timestamp for dense admin tables. */
export function formatUtc(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/** Longest JSON preview shown in a table cell. */
const PREVIEW_CHARS = 80;

/** A short, single-line rendering of a stored JSON value. */
export function previewJson(value: unknown): string {
  const text = value === undefined ? '' : JSON.stringify(value);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
}

/** "Oct 24, 2026" in a timezone; the timezone falls back to UTC when the runtime does not know it. */
export function formatDay(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
}

/** The first and last day of a span whose end is exclusive (the start of the day after), in a timezone. */
export function formatDaySpan(start: Date, endExclusive: Date, timeZone: string): { from: string; to: string } {
  return { from: formatDay(start, timeZone), to: formatDay(new Date(endExclusive.getTime() - 1), timeZone) };
}
