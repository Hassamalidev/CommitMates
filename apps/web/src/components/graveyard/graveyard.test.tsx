// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { GraveyardItem, GraveyardResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askOwnerUrl, filterItems, forkUrl, licenseChooserUrl, parseGraveyard } from '@/lib/graveyard';

import { GraveyardCard } from './GraveyardCard';
import { GraveyardTool } from './GraveyardTool';

const actions = vi.hoisted(() => ({
  recordAdoptionInterestAction: vi.fn(() => Promise.resolve({ ok: true as const, data: { recorded: true } })),
  requestAdoptionAction: vi.fn(() => Promise.resolve({ ok: true as const, data: null })),
}));
vi.mock('@/server/actions/adoptions', () => actions);

const item = (fullName: string, overrides: Partial<GraveyardItem> = {}): GraveyardItem => ({
  githubId: fullName.length,
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
  listing: null,
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
  actions.recordAdoptionInterestAction.mockClear();
  actions.requestAdoptionAction.mockClear();
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
    expect(licenseChooserUrl('someone/app')).toBe('https://github.com/someone/app/community/license/new');
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

  it('records a verified member’s interest when they follow a link, and nobody else’s', () => {
    render(<GraveyardCard item={result.items[0]!} verified />);
    fireEvent.click(screen.getByRole('link', { name: 'Fork on GitHub' }));
    expect(actions.recordAdoptionInterestAction).toHaveBeenCalledWith(result.items[0]!.githubId);
    cleanup();
    render(<GraveyardCard item={result.items[0]!} />);
    fireEvent.click(screen.getByRole('link', { name: 'Ask the owner' }));
    expect(actions.recordAdoptionInterestAction).toHaveBeenCalledTimes(1);
  });

  it('shows a university listing as up for adoption, with its owner, note and an Adopt request', async () => {
    const listed = item('classmate/dash', { licenseSpdx: null, listing: { id: '0b6a8f2e-7c1d-4e5f-9a0b-1c2d3e4f5a6b', note: 'Needs a frontend', ownerLogin: 'classmate' } });
    const { container } = render(<GraveyardCard item={listed} verified />);
    const card = screen.getByRole('article', { name: 'classmate/dash' });
    expect(within(card).getByText('Up for adoption')).toBeTruthy();
    expect(within(card).getByText('Listed by @classmate')).toBeTruthy();
    expect(within(card).getByText(/Needs a frontend/)).toBeTruthy();
    expect(within(card).queryByText(/Inactive/)).toBeNull();
    expect(within(card).queryByRole('link', { name: /Ask the owner/ })).toBeNull();
    expect(await findA11yViolations(container)).toEqual([]);

    fireEvent.click(within(card).getByRole('button', { name: 'Adopt classmate/dash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adopt classmate/dash' });
    fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'I would love to build the frontend for this.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByText("Request sent. @classmate's reply will appear in your inbox.")).toBeTruthy();
    });
    const form = actions.requestAdoptionAction.mock.calls[0] as unknown as [unknown, FormData];
    expect(form[1].get('listingId')).toBe('0b6a8f2e-7c1d-4e5f-9a0b-1c2d3e4f5a6b');
    expect(form[1].get('message')).toBe('I would love to build the frontend for this.');
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

  it('asks visitors to sign in and unverified members to verify before the uni tab', () => {
    render(<GraveyardTool />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'My uni' }));
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth/sign-in?next=%2Ftools%2Fgraveyard%3Fscope%3Duni');
    cleanup();
    render(<GraveyardTool viewer="member" initialScope="uni" />);
    expect(screen.getByRole('link', { name: 'Verify your university' }).getAttribute('href')).toBe('/onboarding');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'My country' }));
    expect(screen.getByText(/Verify your university to search inactive projects by developers in its country/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches the university’s listings for verified members, and re-searches the topic when the tab changes', async () => {
    const uni: GraveyardResult = { ...result, scope: 'uni', items: [item('classmate/dash', { listing: { id: 'l1', note: null, ownerLogin: 'classmate' } })] };
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: uni }));
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result }));
    render(<GraveyardTool viewer="verified" initialScope="uni" initialQuery="react" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('graveyard-item')).toHaveLength(1);
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"q":"react","scope":"uni"}');
    expect(screen.getByRole('link', { name: 'List yours' }).getAttribute('href')).toBe('/settings/projects');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Global' }));
    await waitFor(() => {
      expect(screen.getAllByTestId('graveyard-item')).toHaveLength(3);
    });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"q":"react","scope":"global"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe('?q=react');
  });

  it('searches the country index for verified members', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'done', result: { ...result, scope: 'country' } }));
    render(<GraveyardTool viewer="verified" initialScope="country" initialQuery="vision" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('graveyard-item')).toHaveLength(3);
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"q":"vision","scope":"country"}');
    expect(screen.getByText(/from the country index/)).toBeTruthy();
    // Results there are still called inactive, never "up for adoption" (§8 F7 "Language rules").
    expect(screen.getAllByText(/Inactive for/).length).toBeGreaterThan(0);
  });
});
