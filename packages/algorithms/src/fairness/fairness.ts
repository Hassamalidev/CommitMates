/**
 * Group Fairness Report: who contributed how much code to a team repository.
 * Formula: Gini G = Σ_i Σ_j |x_i − x_j| / (2 n² x̄);
 *          least-share ratio = min share ÷ (1 / n); flagged when it is below the threshold;
 *          late share = share of a person's commits in the final `lateWindowPct` of the
 *          repository's active weeks (rounded up to whole weeks)
 * Settings: fairness.leastShareThreshold, fairness.lateWindowPct
 * Spec: CLAUDE.md §8 F4 "Algorithm"
 */

import { sum } from '../stats/basic';

/** One contributor, as the report and the browser's identity merge both see them. */
export type Contributor = {
  /** `id:<github id>` for accounts, `email:<hash>` for commits without one. */
  key: string;
  login: string | null;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
  commits: number;
  /** `null` when line counts are not known for this person (commits-only data). */
  additions: number | null;
  deletions: number | null;
  /** Commits per week, aligned with the report's week list. */
  weekly: number[];
  /** Distinct files changed; `null` when per-commit data was not read. */
  filesTouched: number | null;
};

export type FairnessMetric = 'commits' | 'lines';

/** Inequality of a distribution: 0 when equal, approaching 1 when one holds everything. */
export function gini(values: readonly number[]): number {
  const n = values.length;
  const mean = n === 0 ? 0 : sum(values) / n;
  if (n <= 1 || mean === 0) return 0;
  let differences = 0;
  for (const a of values) for (const b of values) differences += Math.abs(a - b);
  // allowed-literal: the 2 of the Gini formula
  return differences / (2 * n * n * mean);
}

/** The smallest share divided by an equal share; `null` with fewer than two people or nothing to share. */
export function leastShareRatio(values: readonly number[]): number | null {
  const total = sum(values);
  if (values.length <= 1 || total === 0) return null;
  return Math.min(...values) / total / (1 / values.length);
}

/** A person's amount of the chosen metric; `null` when it is unknown for them. */
export function metricValue(person: Contributor, metric: FairnessMetric): number | null {
  if (metric === 'commits') return person.commits;
  return person.additions === null || person.deletions === null ? null : person.additions + person.deletions;
}

/**
 * Folds identities into others, as a person merging "J. Doe" into "jdoe" would expect:
 * counts and weeks add up, the target's name and account stay. `merges` maps a key to the
 * key it joins; chains are followed and cycles are ignored.
 */
export function mergeContributors(people: readonly Contributor[], merges: Readonly<Record<string, string>>): Contributor[] {
  const byKey = new Map(people.map((person) => [person.key, person]));
  const root = (key: string): string => {
    const seen = new Set([key]);
    let current = key;
    for (;;) {
      const next = merges[current];
      if (next === undefined || !byKey.has(next)) return current;
      // A cycle merges nobody.
      if (seen.has(next)) return key;
      seen.add(next);
      current = next;
    }
  };
  const merged = new Map<string, Contributor>();
  // Targets first, so the person who stays keeps their own name and account.
  const ordered = [...people].sort((a, b) => Number(root(a.key) !== a.key) - Number(root(b.key) !== b.key));
  for (const person of ordered) {
    const target = root(person.key);
    const existing = merged.get(target);
    if (!existing) {
      merged.set(target, { ...person, key: target, weekly: [...person.weekly] });
      continue;
    }
    const addLines = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
    existing.commits += person.commits;
    existing.additions = addLines(existing.additions, person.additions);
    existing.deletions = addLines(existing.deletions, person.deletions);
    existing.filesTouched = existing.filesTouched === null || person.filesTouched === null ? null : Math.max(existing.filesTouched, person.filesTouched);
    existing.isBot = existing.isBot && person.isBot;
    const length = Math.max(existing.weekly.length, person.weekly.length);
    existing.weekly = Array.from({ length }, (_, week) => (existing.weekly[week] ?? 0) + (person.weekly[week] ?? 0));
  }
  return people.flatMap((person) => merged.get(person.key) ?? []);
}

/** Each person's share of commits in the final part of the team's active weeks. */
export function lateShares(people: readonly Contributor[], lateWindowPct: number): Map<string, number> {
  const length = Math.max(0, ...people.map((person) => person.weekly.length));
  const team = Array.from({ length }, (_, week) => sum(people.map((person) => person.weekly[week] ?? 0)));
  const first = team.findIndex((count) => count > 0);
  const last = team.length - 1 - [...team].reverse().findIndex((count) => count > 0);
  const shares = new Map<string, number>();
  if (first === -1) {
    for (const person of people) shares.set(person.key, 0);
    return shares;
  }
  const span = last - first + 1;
  const lateFrom = last - Math.ceil(span * Math.min(1, Math.max(0, lateWindowPct))) + 1;
  for (const person of people) {
    const total = sum(person.weekly);
    const late = sum(person.weekly.slice(Math.max(first, lateFrom), last + 1));
    shares.set(person.key, total === 0 ? 0 : late / total);
  }
  return shares;
}

export type TeamMetrics = {
  people: { key: string; value: number; share: number }[];
  gini: number | null;
  leastShareRatio: number | null;
  flagged: boolean;
  /** False when there is one person (or none) left to compare, or the metric is unknown for someone. */
  applicable: boolean;
};

/**
 * Shares, Gini and the least-share flag for the chosen metric. Bots are left out unless
 * included; people with nothing of the metric still count, since they are part of the team.
 */
export function teamMetrics(
  people: readonly Contributor[],
  options: { metric: FairnessMetric; includeBots: boolean; leastShareThreshold: number },
): TeamMetrics {
  const counted = people.filter((person) => options.includeBots || !person.isBot);
  const values = counted.map((person) => metricValue(person, options.metric));
  if (values.some((value) => value === null)) {
    return { people: [], gini: null, leastShareRatio: null, flagged: false, applicable: false };
  }
  const known = values.map((value) => value ?? 0);
  const total = sum(known);
  const shares = counted.map((person, index) => ({ key: person.key, value: known[index] ?? 0, share: total === 0 ? 0 : (known[index] ?? 0) / total }));
  const ratio = leastShareRatio(known);
  const applicable = counted.length > 1 && total > 0;
  return {
    people: shares.sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1)),
    gini: applicable ? gini(known) : null,
    leastShareRatio: applicable ? ratio : null,
    flagged: applicable && ratio !== null && ratio < options.leastShareThreshold,
    applicable,
  };
}
