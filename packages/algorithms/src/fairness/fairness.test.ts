import { describe, expect, it } from 'vitest';

import { gini, lateShares, leastShareRatio, mergeContributors, metricValue, teamMetrics, type Contributor } from './fairness';

const person = (key: string, commits: number, overrides: Partial<Contributor> = {}): Contributor => ({
  key,
  login: key,
  name: key,
  avatarUrl: null,
  isBot: false,
  commits,
  additions: commits * 10,
  deletions: commits * 2,
  weekly: [commits],
  filesTouched: null,
  ...overrides,
});

describe('gini', () => {
  it('matches hand-computed values', () => {
    expect(gini([5, 5, 5])).toBe(0);
    // Pairs: |0-0|,|0-10|,… → Σ = 2·(10 + 10) = 40; 2·n²·mean = 2·9·(10/3) = 60.
    expect(gini([0, 0, 10])).toBeCloseTo(40 / 60, 12);
    // [1, 3]: Σ = 4; 2·4·2 = 16.
    expect(gini([1, 3])).toBe(0.25);
  });

  it('is 0 for one person, nobody, or nothing at all', () => {
    expect(gini([])).toBe(0);
    expect(gini([7])).toBe(0);
    expect(gini([0, 0])).toBe(0);
  });
});

describe('leastShareRatio', () => {
  it('divides the smallest share by an equal one', () => {
    expect(leastShareRatio([10, 10, 10, 10])).toBe(1);
    // Smallest 5 of 100 = 0.05; equal share 0.25.
    expect(leastShareRatio([5, 45, 25, 25])).toBeCloseTo(0.2, 12);
    expect(leastShareRatio([0, 10])).toBe(0);
  });

  it('is null with fewer than two people or nothing shared', () => {
    expect(leastShareRatio([10])).toBeNull();
    expect(leastShareRatio([0, 0])).toBeNull();
  });
});

describe('metricValue', () => {
  it('reads commits or lines, and knows when lines are unknown', () => {
    expect(metricValue(person('a', 3), 'commits')).toBe(3);
    expect(metricValue(person('a', 3), 'lines')).toBe(36);
    expect(metricValue(person('a', 3, { additions: null }), 'lines')).toBeNull();
  });
});

describe('teamMetrics', () => {
  const options = { metric: 'commits' as const, includeBots: false, leastShareThreshold: 0.14 };

  it('reports shares largest first, Gini and the flag', () => {
    const metrics = teamMetrics([person('a', 2), person('b', 40), person('c', 30), person('d', 28)], options);
    expect(metrics.people.map((entry) => entry.key)).toEqual(['b', 'c', 'd', 'a']);
    expect(metrics.people[0]?.share).toBe(0.4);
    expect(metrics.leastShareRatio).toBeCloseTo(0.02 / 0.25, 12);
    expect(metrics.flagged).toBe(true);
    expect(metrics.gini).toBeCloseTo(gini([2, 40, 30, 28]), 12);
  });

  it('does not flag a balanced team and follows the threshold', () => {
    const team = [person('a', 20), person('b', 25), person('c', 30)];
    expect(teamMetrics(team, options).flagged).toBe(false);
    expect(teamMetrics(team, { ...options, leastShareThreshold: 0.9 }).flagged).toBe(true);
  });

  it('leaves bots out unless asked', () => {
    const team = [person('a', 10), person('b', 10), person('dependabot', 300, { isBot: true })];
    expect(teamMetrics(team, options).people).toHaveLength(2);
    expect(teamMetrics(team, { ...options, includeBots: true }).flagged).toBe(true);
  });

  it('is not applicable for one person, an unknown metric, or no work', () => {
    expect(teamMetrics([person('a', 5)], options)).toMatchObject({ applicable: false, gini: null, flagged: false });
    expect(teamMetrics([person('a', 5), person('b', 5, { deletions: null })], { ...options, metric: 'lines' })).toMatchObject({ applicable: false });
    expect(teamMetrics([person('a', 0), person('b', 0)], options)).toMatchObject({ applicable: false, leastShareRatio: null });
  });
});

describe('mergeContributors', () => {
  const team = [
    person('id:1', 10, { name: 'jdoe', weekly: [5, 5], filesTouched: 4 }),
    person('email:x', 3, { login: null, name: 'J. Doe', weekly: [0, 3], filesTouched: 2 }),
    person('id:2', 7, { weekly: [7, 0] }),
  ];

  it('adds counts and weeks into the identity that stays', () => {
    const merged = mergeContributors(team, { 'email:x': 'id:1' });
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ key: 'id:1', name: 'jdoe', login: 'id:1', commits: 13, additions: 130, deletions: 26, weekly: [5, 8], filesTouched: 4 });
  });

  it('follows chains, ignores cycles and unknown targets', () => {
    expect(mergeContributors(team, { 'email:x': 'id:2', 'id:2': 'id:1' }).map((entry) => [entry.key, entry.commits])).toEqual([['id:1', 20]]);
    expect(mergeContributors(team, { 'id:1': 'id:2', 'id:2': 'id:1' })).toHaveLength(3);
    expect(mergeContributors(team, { 'email:x': 'nobody' })).toHaveLength(3);
  });

  it('keeps unknown line counts unknown and a human merged with a bot human', () => {
    const merged = mergeContributors([person('id:1', 1), person('bot', 1, { isBot: true, additions: null })], { bot: 'id:1' });
    expect(merged[0]).toMatchObject({ additions: null, isBot: false });
  });
});

describe('lateShares', () => {
  it('measures each person in the final share of the active weeks', () => {
    // Active weeks 1–10 (index 1..10); the final 15% rounds up to 2 weeks: 9 and 10.
    const weeks = (entries: Record<number, number>) => Array.from({ length: 12 }, (_, week) => entries[week] ?? 0);
    const shares = lateShares([person('steady', 0, { weekly: weeks({ 1: 2, 5: 2, 9: 1, 10: 1 }) }), person('late', 0, { weekly: weeks({ 10: 4 }) })], 0.15);
    expect(shares.get('steady')).toBeCloseTo(2 / 6, 12);
    expect(shares.get('late')).toBe(1);
  });

  it('is 0 for everyone without activity', () => {
    expect(lateShares([person('a', 0, { weekly: [0, 0] })], 0.15).get('a')).toBe(0);
  });
});
