// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { GraveyardItem, GraveyardResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askOwnerUrl, filterItems, forkUrl, parseGraveyard } from '@/lib/graveyard';

import { GraveyardCard } from './GraveyardCard';
import { GraveyardTool } from './GraveyardTool';

const item = (fullName: string, overrides: Partial<GraveyardItem> = {}): GraveyardItem => ({
  fullName,
  description: 'An object tracker',
  stars: 40,
  forks: 3,
  openIssues: 6,
  licenseSpdx: 'MIT',
  archived: false,
  pushedAt: '2025-08-01T00:00:00Z',
  idleMonths: 14.2,
  category: 'computer-vision',
  difficulty: 'half-built',
  unfinished: 0.7,
  revivability: 0.62,
  rank: 0.62,
  signals: { readmeUnfinished: true, unansweredIssues: 0.5, unfinishedCommits: 0.25, noReleases: true },
  ...overrides,
});

const result: GraveyardResult = {
  query: 'computer vision',
  scope: 'global',
  terms: ['computer-vision', 'opencv'],
  items: [item('someone/half-vision'), item('someone/no-license', { licenseSpdx: null, difficulty: 'weekend-fix' }), item('someone/old', { archived: true, difficulty: null })],
  suggestions: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('graveyard helpers', () => {
  it('parses results and filters by difficulty and license', () => {
    expect(parseGraveyard(result)).toBe(result);
    expect(parseGraveyard({ ...result, items: [{ fullName: 1 }] })).toBeNull();
    expect(parseGraveyard(null)).toBeNull();
    expect(filterItems(result.items, 'any', 'unlicensed').map((entry) => entry.fullName)).toEqual(['someone/no-license']);
    expect(filterItems(result.items, 'half-built', 'licensed').map((entry) => entry.fullName)).toEqual(['someone/half-vision']);
  });

  it('builds the fork and ask-the-owner links without contacting anyone itself', () => {
    expect(forkUrl('someone/app')).toBe('https://github.com/someone/app/fork');
    const ask = new URL(askOwnerUrl('someone/app'));
    expect(ask.origin + ask.pathname).toBe('https://github.com/someone/app/issues/new');
    expect(ask.searchParams.get('title')).toBe('Is this project still maintained?');
    expect(ask.searchParams.get('body')).toContain('someone/app');
  });
});

describe('GraveyardCard', () => {
  it('shows the project, why it is here and how to pick it up', () => {
    render(<GraveyardCard item={result.items[0]!} />);
    const card = screen.getByRole('article', { name: 'someone/half-vision' });
    expect(within(card).getByText('Half-built idea')).toBeTruthy();
    expect(within(card).getByText(/Inactive for 14 months/)).toBeTruthy();
    expect(within(card).getByText('The README says it is unfinished or lists open tasks.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Fork on GitHub' }).getAttribute('href')).toBe('https://github.com/someone/half-vision/fork');
    expect(within(card).getByRole('link', { name: 'Ask the owner' })).toBeTruthy();
  });

  it('offers only a question to the owner when there is no license', () => {
    render(<GraveyardCard item={result.items[1]!} />);
    expect(screen.queryByRole('link', { name: 'Fork on GitHub' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ask the owner first' })).toBeTruthy();
    expect(screen.getByText(/Without a license the code cannot be reused freely/)).toBeTruthy();
  });

  it('marks archived projects as fork-only and has no serious violations', async () => {
    const { container } = render(<GraveyardCard item={result.items[2]!} />);
    expect(screen.getByText('Archived — fork only')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Fork on GitHub' })).toBeNull();
    expect(await findA11yViolations(container)).toEqual([]);
  });
});

describe('GraveyardTool', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (body: unknown) => Promise.resolve(Response.json(body));

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/tools/graveyard');
  });

  it('searches, lists the results and filters them on the page', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result }));
    render(<GraveyardTool />);
    fireEvent.change(screen.getByLabelText('Topic or idea'), { target: { value: 'computer vision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(screen.getAllByTestId('graveyard-item')).toHaveLength(3);
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"q":"computer vision","scope":"global"}');
    expect(screen.getByText('Also searched: computer-vision, opencv.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('License'), { target: { value: 'unlicensed' } });
    expect(screen.getAllByTestId('graveyard-item')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '1 of 3 inactive projects' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'half-built' } });
    expect(screen.getByText('No project matches these filters.')).toBeTruthy();
  });

  it('suggests broader topics when nothing matched, and searches them on a click', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { ...result, items: [], suggestions: ['image-processing'] } }));
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result }));
    render(<GraveyardTool initialQuery="very niche thing" />);
    await waitFor(() => {
      expect(screen.getByText('No inactive projects matched.')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'image-processing' }));
    await waitFor(() => {
      expect(screen.getAllByTestId('graveyard-item')).toHaveLength(3);
    });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"q":"image processing","scope":"global"}');
  });

  it('keeps locked scopes behind their own tabs', () => {
    render(<GraveyardTool />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'My uni' }));
    fireEvent.click(screen.getByRole('tab', { name: 'My uni' }));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
