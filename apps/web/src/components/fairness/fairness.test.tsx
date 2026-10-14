// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { FairnessResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { parseFairness } from '@/lib/fairness';

import { FairnessView } from './FairnessView';

const person = (key: string, login: string | null, commits: number, overrides: Partial<FairnessResult['contributors'][number]> = {}) => ({
  key,
  login,
  name: login ?? key,
  avatarUrl: null,
  isBot: false,
  commits,
  additions: commits * 10,
  deletions: commits,
  weekly: [commits, 0],
  filesTouched: null,
  ...overrides,
});

const report: FairnessResult = {
  repo: { fullName: 'team/project', githubId: 77 },
  mode: 'stats',
  weeks: ['2026-09-06', '2026-09-13'],
  contributors: [
    person('id:1', 'alice', 40),
    person('id:2', 'bob', 30),
    person('email:c', null, 2, { name: 'Bob B', weekly: [0, 2] }),
    person('id:3', 'dependabot[bot]', 300, { isBot: true }),
  ],
  commitsAnalyzed: 300,
  excludedPaths: 2,
  excludedLines: 1200,
  coAuthorCredits: 1,
};
const thresholds = { leastShareThreshold: 0.14, lateWindowPct: 0.5 };

afterEach(() => {
  cleanup();
});

describe('parseFairness', () => {
  it('accepts a stored report and rejects other shapes', () => {
    expect(parseFairness(report)).toBe(report);
    for (const bad of [null, {}, { ...report, mode: 'other' }, { ...report, repo: {} }, { ...report, contributors: [{ key: 1 }] }, { ...report, weeks: null }]) {
      expect(parseFairness(bad)).toBeNull();
    }
  });
});

describe('FairnessView', () => {
  const shareRows = () => within(screen.getByRole('table', { name: /Share of .* per person/ })).getAllByRole('row').slice(1).map((row) => row.textContent);

  it('heads the report neutrally and shows shares largest first, without bots', () => {
    render(<FairnessView result={report} thresholds={thresholds} />);
    expect(screen.getByRole('heading', { name: 'Code contribution report for team/project' })).toBeTruthy();
    expect(shareRows()).toEqual(['alice56% · 40 commits', 'bob42% · 30 commits', 'Bob B (no GitHub account)3% · 2 commits']);
  });

  it('says the work is uneven without naming anyone', () => {
    render(<FairnessView result={report} thresholds={thresholds} />);
    const team = screen.getByTestId('fairness-team');
    expect(within(team).getByText('Contribution is uneven: the smallest share is below 14% of an equal split.')).toBeTruthy();
    expect(team.textContent).not.toMatch(/alice|bob/i);
    expect(within(team).getByText(/Design, writing, testing outside the repository/)).toBeTruthy();
    expect(screen.getByText('Left out 1,200 lines in generated, vendored or documentation files.')).toBeTruthy();
  });

  it('merges an identity into an account and recomputes everything', () => {
    render(<FairnessView result={report} thresholds={thresholds} />);
    fireEvent.change(screen.getByLabelText('Merge Bob B into (2 commits)'), { target: { value: 'id:2' } });
    expect(shareRows()).toEqual(['alice56% · 40 commits', 'bob44% · 32 commits']);
    expect(screen.getByText('No one is far below an equal share.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Merge Bob B into (2 commits)'), { target: { value: '' } });
    expect(shareRows()).toHaveLength(3);
  });

  it('switches to lines and includes bots on request', () => {
    render(<FairnessView result={report} thresholds={thresholds} />);
    fireEvent.change(screen.getByLabelText('Measure'), { target: { value: 'lines' } });
    expect(shareRows()[0]).toBe('alice56% · 440 lines');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include bots' }));
    expect(shareRows()[0]).toContain('dependabot[bot]');
  });

  it('counts commits when line counts are unknown for someone', () => {
    render(<FairnessView result={{ ...report, contributors: [person('id:1', 'alice', 4), person('email:c', null, 2, { additions: null, deletions: null })] }} thresholds={thresholds} />);
    expect(screen.getByRole('option', { name: 'Lines changed' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Line counts are not available for everyone/)).toBeTruthy();
  });

  it('explains a one-person repository and a commits-only report', () => {
    render(<FairnessView result={{ ...report, mode: 'commits', contributors: [person('id:1', 'alice', 4)] }} thresholds={thresholds} />);
    expect(screen.getByText('Only one person contributed code, so there is nothing to compare.')).toBeTruthy();
    expect(screen.getByText(/too large for GitHub’s statistics/)).toBeTruthy();
    expect(screen.queryByTestId('fairness-merge')).toBeNull();
  });

  it('notes people who did most of their work at the end', () => {
    render(<FairnessView result={report} thresholds={thresholds} />);
    expect(screen.getByText('1 person made most of their commits in the final 50% of the project.')).toBeTruthy();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(<FairnessView result={report} thresholds={thresholds} />);
    expect(await findA11yViolations(container)).toEqual([]);
  });
});
