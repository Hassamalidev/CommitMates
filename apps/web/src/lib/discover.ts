import type { DeckCard } from '@commitmates/core';
import type { CompanionInput } from '@commitmates/ui';

import { devCardCopy, isDevCardLabelKey } from '@/copy/dev-card';
import { discoverCopy } from '@/copy/discover';

import { localHourRange } from './compat';
import { companionFor } from './dev-card';

/** What the browser needs to draw one card; reasons are written on the server in the member's timezone. */
export type DeckCardView = {
  suggestionId: string;
  login: string;
  name: string;
  details: string;
  labels: string[];
  tags: string[];
  reasons: string[];
  companion: CompanionInput;
};

/**
 * The "why" lines of a card (CLAUDE.md §8 F11 "Explanations"), from template keys and real values.
 * Covered tags are the member's learning goals when they set some, otherwise the university's
 * common tags they have not used yet. Shared hours are shown in the member's own timezone (§6.10).
 */
export function reasonsFor(why: DeckCard['why'], hasGoals: boolean, timeZone: string, on: Date = new Date()): string[] {
  const copy = discoverCopy.why;
  const lines: string[] = [];
  if (why.sharedTags.length > 0) lines.push(copy.sharedTags(why.sharedTags));
  if (why.coverage.length > 0) lines.push(hasGoals ? copy.coverageGoals(why.coverage) : copy.coverageGaps(why.coverage));
  if (why.sharedInterests > 0) lines.push(copy.sharedInterests(why.sharedInterests));
  if (why.window) {
    const [from, to] = localHourRange(why.window, timeZone, on);
    lines.push(copy.window(from, to));
  }
  return lines;
}

/** A core card as the page draws it. Unknown label keys are left out rather than shown raw. */
export function toCardView(card: DeckCard, hasGoals: boolean, timeZone: string, on: Date = new Date()): DeckCardView {
  return {
    suggestionId: card.suggestionId,
    login: card.login,
    name: card.name ?? `@${card.login}`,
    details: discoverCopy.card.details(card.login, card.department, card.gradYear),
    labels: card.labels.flatMap((key) => (isDevCardLabelKey(key) ? [devCardCopy.labels[key].name] : [])),
    tags: card.tags,
    reasons: reasonsFor(card.why, hasGoals, timeZone, on),
    companion: companionFor({ companion: card.companion }),
  };
}

/** Discover's address for a mode, keeping the filters. */
export function discoverHref(mode: string, filters: Readonly<Record<string, string | number | undefined>> = {}): string {
  const params = new URLSearchParams({ mode });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `/discover?${params.toString()}`;
}
