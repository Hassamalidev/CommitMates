// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import type { GapResult } from '@commitmates/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  gapHelpersAction: vi.fn(),
  askGapHelperAction: vi.fn(() => Promise.resolve({ ok: true as const, data: null })),
}));
vi.mock('@/server/actions/gap', () => actions);

const { GapCampusPanel, gapTag } = await import('./GapCampusPanel');
const { facetLabel } = await import('./GapView');

const result: GapResult = {
  repo: { fullName: 'me/app', githubId: 1 },
  peers: [{ fullName: 'a/one', stars: 500 }],
  gaps: [
    { facet: 'file:dockerfile', kind: 'path', name: 'dockerfile', topic: 'Docker', prevalence: 1, peersWith: 1, examples: [] },
    { facet: 'tag:testing', kind: 'tag', name: 'testing', topic: 'Testing', prevalence: 1, peersWith: 1, examples: [] },
    { facet: 'meta:license', kind: 'meta', name: 'license', topic: null, prevalence: 1, peersWith: 1, examples: [] },
    { facet: 'dir:tests', kind: 'path', name: 'tests', topic: null, prevalence: 1, peersWith: 1, examples: [] },
  ],
  shared: [],
  lowConfidence: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('gapTag', () => {
  it('maps tags to themselves and paths to their topic; properties have none', () => {
    expect(result.gaps.map(gapTag)).toEqual(['Docker', 'testing', null, null]);
  });
});

describe('GapCampusPanel', () => {
  it('explains the unlock to visitors without asking the server', () => {
    render(<GapCampusPanel result={result} campusMinMembers={10} signedIn={false} label={facetLabel} />);
    expect(screen.getByText(/once it has 10 verified members/)).toBeTruthy();
    expect(actions.gapHelpersAction).not.toHaveBeenCalled();
  });

  it('shows the progress while locked', async () => {
    actions.gapHelpersAction.mockResolvedValueOnce({ ok: true, data: { state: 'locked', current: 4, required: 10 } });
    render(<GapCampusPanel result={result} campusMinMembers={10} signedIn label={facetLabel} />);
    expect(await screen.findByText('This opens at 10 verified members of your university (4 so far).')).toBeTruthy();
    expect(actions.gapHelpersAction).toHaveBeenCalledWith(['Docker', 'testing']);
  });

  it('lists helpers per gap and sends a prefilled request', async () => {
    actions.gapHelpersAction.mockResolvedValueOnce({ ok: true, data: { state: 'open', helpers: { Docker: [{ userId: 'u1', login: 'kim', level: 0.8 }], testing: [] } } });
    const { container } = render(<GapCampusPanel result={result} campusMinMembers={10} signedIn label={facetLabel} />);
    expect(await screen.findByRole('button', { name: 'Ask @kim' })).toBeTruthy();
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
    expect(await findA11yViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask @kim' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ask @kim for help' });
    const message = within(dialog).getByLabelText<HTMLTextAreaElement>('Message');
    expect(message.value).toContain('me/app is missing a dockerfile file (Docker)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      expect(screen.getByText('Request sent to @kim.')).toBeTruthy();
    });
    const form = actions.askGapHelperAction.mock.calls[0] as unknown as [unknown, FormData];
    expect([form[1].get('toUserId'), form[1].get('repoFullName'), form[1].get('tag')]).toEqual(['u1', 'me/app', 'Docker']);
  });

  it('says so when nobody here has the skills', async () => {
    actions.gapHelpersAction.mockResolvedValueOnce({ ok: true, data: { state: 'open', helpers: { Docker: [], testing: [] } } });
    render(<GapCampusPanel result={result} campusMinMembers={10} signedIn label={facetLabel} />);
    expect(await screen.findByText('Nobody here shows these skills in their code yet.')).toBeTruthy();
  });
});
