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
