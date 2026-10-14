import { describe, expect, it } from 'vitest';

import { adjustedUnfinished, monthsBetween, scoreRevivals, type RevivalInput } from './graveyard';

const settings = { weights: { promise: 0.35, demand: 0.25, unfinished: 0.25, freshness: 0.15 }, freshMonths: 24, noLicenseFactor: 0.3 };

const candidate = (key: string, overrides: Partial<RevivalInput> = {}): RevivalInput => ({
  key,
  stars: 10,
  forks: 2,
  openIssues: 3,
  recentStars: 0,
  unfinished: 0.5,
  idleMonths: 12,
  hasLicense: true,
  sizeKb: 500,
  relevance: 1,
  ...overrides,
});

describe('adjustedUnfinished', () => {
  const none = { hasReleases: false, allIssuesClosed: false, totalIssues: 0, readme: '# App' };

  it('takes the finished signals off and clamps', () => {
    expect(adjustedUnfinished(0.75, none)).toBe(0.75);
    expect(adjustedUnfinished(0.75, { ...none, hasReleases: true })).toBe(0.5);
    expect(adjustedUnfinished(0.75, { ...none, allIssuesClosed: true, totalIssues: 6 })).toBe(0.5);
    expect(adjustedUnfinished(0.75, { ...none, allIssuesClosed: true, totalIssues: 5 })).toBe(0.75);
    expect(adjustedUnfinished(0.75, { ...none, readme: '# App\n## Installation\nnpm i' })).toBeCloseTo(0.6, 12);
    expect(adjustedUnfinished(0.1, { ...none, hasReleases: true, readme: '## Usage' })).toBe(0);
    expect(adjustedUnfinished(null, none)).toBe(0);
  });
});

describe('scoreRevivals', () => {
  it('normalizes promise and demand within the set and applies weights, freshness and license', () => {
    const [low, high] = scoreRevivals(
      [candidate('low', { stars: 0, forks: 0, openIssues: 0 }), candidate('high', { stars: 99, forks: 0, openIssues: 9, recentStars: 90 })],
      settings,
    );
    expect(low?.revivability).toBeCloseTo(0.25 * 0.5 + 0.15, 12);
    expect(high?.revivability).toBeCloseTo(0.35 + 0.25 + 0.25 * 0.5 + 0.15, 12);
    expect(high?.promise).toBe(2);
    expect(high?.demand).toBe(2);
  });

  it('halves freshness after freshMonths and penalizes a missing license', () => {
    const [scored] = scoreRevivals([candidate('old', { idleMonths: 30, hasLicense: false })], settings);
    expect(scored?.freshness).toBe(0.5);
    expect(scored?.legal).toBe(0.3);
    // A single candidate normalizes to 0 on promise and demand.
    expect(scored?.revivability).toBeCloseTo((0.25 * 0.5 + 0.15 * 0.5) * 0.3, 12);
  });

  it('ranks by relevance times revivability', () => {
    const [first, second] = scoreRevivals([candidate('a', { relevance: 1 }), candidate('b', { relevance: 0.5 })], settings);
    expect(second?.rank).toBeCloseTo((first?.rank ?? 0) / 2, 12);
  });

  it('labels difficulty relative to the set', () => {
    const scored = scoreRevivals(
      [
        candidate('small', { sizeKb: 10, openIssues: 0, unfinished: 0.2, stars: 1 }),
        candidate('popular', { sizeKb: 5000, openIssues: 50, stars: 500 }),
        candidate('half', { sizeKb: 20, openIssues: 9, unfinished: 0.8, stars: 2 }),
        candidate('plain', { sizeKb: 900, openIssues: 4, unfinished: 0.3, stars: 20 }),
        candidate('mid', { sizeKb: 800, openIssues: 5, unfinished: 0.1, stars: 30 }),
      ],
      settings,
    );
    expect(Object.fromEntries(scored.map((item) => [item.key, item.difficulty]))).toEqual({
      small: 'weekend-fix',
      popular: 'needs-maintainer',
      half: 'half-built',
      plain: null,
      mid: null,
    });
  });

  it('is empty without candidates', () => {
    expect(scoreRevivals([], settings)).toEqual([]);
  });
});

describe('monthsBetween', () => {
  it('measures idle time in months and never goes negative', () => {
    expect(monthsBetween(new Date('2026-01-14T00:00:00Z'), new Date('2026-10-14T00:00:00Z'))).toBeCloseTo(273 / 30.44, 6);
    expect(monthsBetween(new Date('2026-10-14T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });
});
