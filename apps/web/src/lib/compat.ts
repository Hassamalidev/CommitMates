import type { CompatResult } from '@commitmates/core';

import { formatHour } from './dev-card';

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a comparison that reached the browser; the server validated the full schema. */
export function parseCompat(value: unknown): CompatResult | null {
  if (!isRecord(value)) return null;
  const { a, b, components, explanations, score } = value;
  if (!isRecord(a) || !isRecord(b) || typeof a.login !== 'string' || typeof b.login !== 'string') return null;
  if (!isRecord(a.companion) || !isRecord(b.companion)) return null;
  if (!isRecord(components) || !isRecord(explanations)) return null;
  if (score !== null && typeof score !== 'number') return null;
  return value as CompatResult;
}

/**
 * A run of UTC hours as the viewer's clock shows it, e.g. ["21:00", "23:00"]. `timeZone`
 * defaults to the browser's own; the date only matters on daylight-saving days.
 */
export function localHourRange(
  window: { startHourUtc: number; hours: number },
  timeZone?: string,
  on: Date = new Date(),
): [string, string] {
  const format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone });
  const base = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  const hourAt = (utcHour: number) => Number(format.format(new Date(base + (utcHour % HOURS_PER_DAY) * MS_PER_HOUR)));
  return [formatHour(hourAt(window.startHourUtc)), formatHour(hourAt(window.startHourUtc + window.hours))];
}
