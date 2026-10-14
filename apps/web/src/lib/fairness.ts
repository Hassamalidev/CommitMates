import type { FairnessResult } from '@commitmates/core';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a report that reached the browser; the server validated the full schema. */
export function parseFairness(value: unknown): FairnessResult | null {
  if (!isRecord(value)) return null;
  const { repo, mode, weeks, contributors } = value;
  if (!isRecord(repo) || typeof repo.fullName !== 'string') return null;
  if (mode !== 'stats' && mode !== 'commits') return null;
  if (!Array.isArray(weeks) || !Array.isArray(contributors)) return null;
  const valid = contributors.every(
    (person) => isRecord(person) && typeof person.key === 'string' && typeof person.commits === 'number' && Array.isArray(person.weekly),
  );
  return valid ? (value as FairnessResult) : null;
}

/** Settings the report needs in the browser to recompute after a merge. */
export type FairnessThresholds = { leastShareThreshold: number; lateWindowPct: number };
