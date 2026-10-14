import { describe, expect, it } from 'vitest';

import { applyGates, issueRank, medianResponseHours, skillMatch } from './oss';

const NOW = new Date('2026-10-14T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe('medianResponseHours', () => {
  it('measures the time to a maintainer reply on issues opened by others', () => {
    const issues = [
      { createdAt: hoursAgo(100), authorAssociation: 'NONE', firstMaintainerReplyAt: hoursAgo(98) },
      { createdAt: hoursAgo(100), authorAssociation: 'CONTRIBUTOR', firstMaintainerReplyAt: hoursAgo(90) },
      // Unanswered: counts as the 40 hours it has waited.
      { createdAt: hoursAgo(40), authorAssociation: 'NONE', firstMaintainerReplyAt: null },
      // Opened by a maintainer: not a newcomer's question.
      { createdAt: hoursAgo(500), authorAssociation: 'OWNER', firstMaintainerReplyAt: null },
    ];
    expect(medianResponseHours(issues, NOW)).toBe(10);
  });

  it('is null without issues from others', () => {
    expect(medianResponseHours([], NOW)).toBeNull();
    expect(medianResponseHours([{ createdAt: hoursAgo(1), authorAssociation: 'MEMBER', firstMaintainerReplyAt: null }], NOW)).toBeNull();
  });
});

describe('skillMatch', () => {
  it('measures how much of what the person knows the project uses', () => {
    expect(skillMatch({ language: 'TypeScript', topics: ['react', 'cli'] }, { languages: ['typescript', 'python'], topics: ['react'] })).toBeCloseTo(2 / 3, 12);
    expect(skillMatch({ language: null, topics: [] }, { languages: ['go'], topics: [] })).toBe(0);
    expect(skillMatch({ language: 'Go', topics: [] }, { languages: [], topics: [] })).toBe(0);
  });
});

describe('issueRank', () => {
  it('weights skill, freshness and responsiveness', () => {
    expect(issueRank({ skillMatch: 1, ageDays: 0, responseHours: 0, maxResponseHours: 168 })).toBe(1);
    expect(issueRank({ skillMatch: 0, ageDays: 30, responseHours: 84, maxResponseHours: 168 })).toBeCloseTo(0.3 * Math.exp(-1) + 0.2 * 0.5, 12);
    expect(issueRank({ skillMatch: 0.5, ageDays: -5, responseHours: null, maxResponseHours: 168 })).toBe(0.25 + 0.3);
    expect(issueRank({ skillMatch: 2, ageDays: 0, responseHours: 500, maxResponseHours: 168 })).toBe(0.8);
  });
});

describe('applyGates', () => {
  const issue = (comments: number, responseHours: number | null) => ({ comments, responseHours });
  const limits = { maxComments: 3, maxResponseHours: 168 };

  it('keeps issues that pass every gate', () => {
    expect(applyGates([issue(1, 10), issue(5, 10), issue(1, 500), issue(0, null)], limits)).toEqual({ kept: [issue(1, 10)], relaxed: [] });
  });

  it('relaxes the comment gate first, then responsiveness', () => {
    expect(applyGates([issue(5, 10)], limits)).toEqual({ kept: [issue(5, 10)], relaxed: ['comments'] });
    expect(applyGates([issue(5, 500)], limits)).toEqual({ kept: [issue(5, 500)], relaxed: ['comments', 'responsiveness'] });
    expect(applyGates([], limits)).toEqual({ kept: [], relaxed: [] });
  });
});
