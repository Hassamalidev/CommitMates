// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { GapResult } from '@commitmates/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { parseGap } from './GapTool';
import { GapView, facetLabel } from './GapView';

const result: GapResult = {
  repo: { fullName: 'me/app', githubId: 1 },
  peers: [
    { fullName: 'a/one', stars: 500 },
    { fullName: 'b/two', stars: 300 },
    { fullName: 'c/three', stars: 200 },
    { fullName: 'd/four', stars: 100 },
  ],
  gaps: [
    { facet: 'dir:tests', kind: 'path', name: 'tests', topic: null, prevalence: 1, peersWith: 4, examples: ['a/one', 'b/two', 'c/three'] },
    { facet: 'file:dockerfile', kind: 'path', name: 'dockerfile', topic: 'Docker', prevalence: 0.75, peersWith: 3, examples: ['a/one'] },
    { facet: 'meta:license', kind: 'meta', name: 'license', topic: null, prevalence: 1, peersWith: 4, examples: [] },
  ],
  shared: [{ facet: 'file:readme.md', kind: 'path', name: 'readme.md', topic: null, prevalence: 1, peersWith: 4 }],
  lowConfidence: true,
};

afterEach(() => {
  cleanup();
});

describe('facetLabel', () => {
  it('says what each kind of facet is', () => {
    expect(facetLabel({ facet: 'dir:tests', kind: 'path', name: 'tests', topic: null })).toBe('A tests/ folder');
    expect(facetLabel({ facet: 'file:dockerfile', kind: 'path', name: 'dockerfile', topic: 'Docker' })).toBe('A dockerfile file (Docker)');
    expect(facetLabel({ facet: 'tag:testing', kind: 'tag', name: 'testing', topic: 'Testing' })).toBe('Uses Testing');
    expect(facetLabel({ facet: 'meta:releases', kind: 'meta', name: 'releases', topic: null })).toBe('Published releases');
    expect(facetLabel({ facet: 'meta:other', kind: 'meta', name: 'other', topic: null })).toBe('other');
  });
});

describe('parseGap', () => {
  it('accepts a stored result and rejects other shapes', () => {
    expect(parseGap(result)).toBe(result);
    for (const bad of [null, {}, { ...result, gaps: null }, { ...result, gaps: [{ facet: 1 }] }, { ...result, repo: null }]) expect(parseGap(bad)).toBeNull();
  });
});

describe('GapView', () => {
  it('lists gaps with how many similar repos have them, examples, and what is already right', () => {
    render(<GapView result={result} campusMinMembers={10} />);
    const view = screen.getByRole('article', { name: 'What similar projects have that me/app does not' });
    expect(within(view).getByText('A tests/ folder')).toBeTruthy();
    expect(within(view).getAllByText('4 of 4 similar repos have this').length).toBeGreaterThan(0);
    expect(within(view).getByText('A dockerfile file (Docker)')).toBeTruthy();
    expect(within(view).getByText(/Only a few similar projects were found/)).toBeTruthy();
    expect(within(view).getByText('A readme.md file')).toBeTruthy();
    expect(screen.getByText(/once it has 10 verified members/)).toBeTruthy();
  });

  it('says so when nothing is missing, and has no serious violations', async () => {
    const { container, unmount } = render(<GapView result={result} campusMinMembers={10} />);
    expect(await findA11yViolations(container)).toEqual([]);
    unmount();
    render(<GapView result={{ ...result, gaps: [], lowConfidence: false }} campusMinMembers={10} />);
    expect(screen.getByText(/Nothing stands out/)).toBeTruthy();
  });
});
