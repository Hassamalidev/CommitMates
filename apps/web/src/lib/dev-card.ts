import type { DevCard } from '@commitmates/core';
import { MAX_STAGE, speciesFor, type CompanionInput } from '@commitmates/ui';

import { brandCompanion } from './brand';

const HOURS_PER_DAY = 24;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === 'number');

/**
 * A structural check of a Dev Card that reached the browser. The server validates the
 * full schema before storing a card; this guards the page against a result of another
 * shape (an older cache entry, a different job) without shipping the server's schema.
 */
export function parseDevCard(value: unknown): DevCard | null {
  if (!isRecord(value)) return null;
  const { login, githubId, hourHist, languages, tags, labels, metrics, companion, calendar90 } = value;
  if (typeof login !== 'string' || typeof githubId !== 'number') return null;
  if (!isNumberArray(hourHist) || hourHist.length !== HOURS_PER_DAY) return null;
  if (!Array.isArray(languages) || !Array.isArray(tags) || !Array.isArray(labels) || !Array.isArray(calendar90)) return null;
  if (!isRecord(metrics) || typeof metrics.total365 !== 'number') return null;
  if (!isRecord(companion) || typeof companion.seed !== 'number' || typeof companion.speciesKey !== 'string') return null;
  return value as DevCard;
}

/**
 * The drawable companion of a card. The card stores what the species is derived from;
 * the species table belongs to the companion engine.
 */
export function companionFor(card: Pick<DevCard, 'companion'>): CompanionInput {
  return {
    seed: card.companion.seed,
    species: speciesFor(card.companion.speciesKey),
    // No language color in the data: the site's own palette, like the brand companion.
    paletteHex: card.companion.paletteHex ?? brandCompanion.paletteHex,
    stage: Math.min(MAX_STAGE, Math.max(0, card.companion.stage)),
    traits: card.companion.traits,
  };
}

const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Oct 14" for a `YYYY-MM-DD` calendar date. */
export function formatCalendarDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormat.format(parsed);
}

/** "09:00" */
export const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
