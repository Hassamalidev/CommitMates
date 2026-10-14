import type { RecruiterResult } from '@commitmates/core';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a report that reached the browser; the server validated the full schema. */
export function parseRecruiter(value: unknown): RecruiterResult | null {
  if (!isRecord(value)) return null;
  const { login, rules, score, usedTopRepos, secretScanRan } = value;
  if (typeof login !== 'string' || !Array.isArray(rules)) return null;
  if (score !== null && typeof score !== 'number') return null;
  if (typeof usedTopRepos !== 'boolean' || typeof secretScanRan !== 'boolean') return null;
  if (!rules.every((rule) => isRecord(rule) && typeof rule.key === 'string' && typeof rule.status === 'string' && isRecord(rule.evidence))) {
    return null;
  }
  return value as RecruiterResult;
}
