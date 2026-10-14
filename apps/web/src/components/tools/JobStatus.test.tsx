// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { JobState } from '@/lib/job-state';

import { JobStatus } from './JobStatus';
import { relatedTools } from './ToolPage';

const steps = [
  { key: 'finding', label: 'Finding the account' },
  { key: 'repos', label: 'Reading repos' },
  { key: 'building', label: 'Building the card' },
];
const show = (state: JobState<unknown>) => render(<JobStatus state={state} steps={steps} idleLine="Enter a username to begin." />);

afterEach(() => {
  cleanup();
});

describe('JobStatus', () => {
  it('rests in the idle state with the idle line and no steps', () => {
    show({ phase: 'idle' });
    expect(screen.getByRole('img', { name: 'The companion is idle' })).toBeTruthy();
    expect(screen.getByText('Enter a username to begin.')).toBeTruthy();
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the current step and its position while working', () => {
    show({ phase: 'working', queued: false, progress: { step: 'repos', message: 'Reading 42 repos…' } });
    expect(screen.getByRole('img', { name: 'The companion is working' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Reading 42 repos… (step 2 of 3)');
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(items[0]?.textContent).toContain('✓');
  });

  it('falls back to the step label, then to a neutral line before the first report', () => {
    const { unmount } = show({ phase: 'working', queued: false, progress: { step: 'building' } });
    expect(screen.getByRole('status').textContent).toBe('Building the card (step 3 of 3)');
    unmount();
    show({ phase: 'working', queued: true, progress: null });
    expect(screen.getByRole('status').textContent).toBe('Getting ready…');
  });

  it('explains a wait with an estimate and keeps the steps visible', () => {
    const until = new Date(Date.now() + 170_000).toISOString();
    show({ phase: 'waiting', until, progress: { step: 'repos' } });
    expect(screen.getByRole('img', { name: 'The companion is waiting' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      "GitHub asked us to slow down — back in about 3 min. You can leave; we'll keep going.",
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('announces completion', () => {
    show({ phase: 'done', result: { anything: true } });
    expect(screen.getByRole('img', { name: 'The companion is done' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Done. Here is what we found.');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('raises errors as alerts with the message from the job', () => {
    show({ phase: 'error', message: "We couldn't find @ghost on GitHub. Check the spelling?" });
    expect(screen.getByRole('img', { name: 'The companion is showing an error' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe("We couldn't find @ghost on GitHub. Check the spelling?");
  });

  it('has no serious accessibility violations in any state', async () => {
    const states: JobState<unknown>[] = [
      { phase: 'idle' },
      { phase: 'working', queued: false, progress: { step: 'repos' } },
      { phase: 'waiting', until: new Date(Date.now() + 60_000).toISOString(), progress: null },
      { phase: 'done', result: null },
      { phase: 'error', message: 'Something broke on our side.' },
    ];
    for (const state of states) {
      const { container, unmount } = show(state);
      expect(await findA11yViolations(container), state.phase).toEqual([]);
      unmount();
    }
  });
});

describe('relatedTools', () => {
  it('lists the other live tools in landing order and nothing that is not live', () => {
    expect(relatedTools('dev-card', new Set())).toEqual([]);
    expect(relatedTools('dev-card', new Set(['dev-card']))).toEqual([]);
    const related = relatedTools('compat', new Set(['fyp-check', 'dev-card', 'compat']));
    expect(related.map((tool) => tool.slug)).toEqual(['dev-card', 'fyp-check']);
  });
});
