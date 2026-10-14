import type { GraveyardItem, GraveyardResult } from '@commitmates/core';

import { graveyardCopy } from '@/copy/graveyard';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a search result that reached the browser; the server validated the full schema. */
export function parseGraveyard(value: unknown): GraveyardResult | null {
  if (!isRecord(value)) return null;
  const { query, items, terms, suggestions } = value;
  if (typeof query !== 'string' || !Array.isArray(items) || !Array.isArray(terms) || !Array.isArray(suggestions)) return null;
  const valid = items.every((item) => isRecord(item) && typeof item.fullName === 'string' && isRecord(item.signals));
  return valid ? (value as GraveyardResult) : null;
}

export type DifficultyFilter = 'any' | NonNullable<GraveyardItem['difficulty']>;
export type LicenseFilter = 'any' | 'licensed' | 'unlicensed';

/** Applies the page's filters to a result (§8 F7 "UI"). */
export function filterItems(items: readonly GraveyardItem[], difficulty: DifficultyFilter, license: LicenseFilter): GraveyardItem[] {
  return items.filter(
    (item) =>
      (difficulty === 'any' || item.difficulty === difficulty) &&
      (license === 'any' || (license === 'licensed') === (item.licenseSpdx !== null)),
  );
}

/** GitHub's fork page for a repository. */
export const forkUrl = (fullName: string) => `https://github.com/${fullName}/fork`;

/** A prefilled new-issue page on the owner's repository (CLAUDE.md §6.1): it opens in the person's own browser. */
export function askOwnerUrl(fullName: string): string {
  const params = new URLSearchParams({ title: graveyardCopy.issue.title, body: graveyardCopy.issue.body(fullName) });
  return `https://github.com/${fullName}/issues/new?${params.toString()}`;
}
