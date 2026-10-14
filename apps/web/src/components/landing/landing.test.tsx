// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleDevCard } from '@/__fixtures__/dev-card';
import { devCardCopy } from '@/copy/dev-card';
import { landingCopy } from '@/copy/landing';
import { toolsCopy } from '@/copy/tools';
import { demoLines } from '@/lib/demo-lines';
import { PRIVATE_PREFIXES, publicPaths } from '@/lib/seo';

import { LiveDemo } from './LiveDemo';

const steps = devCardCopy.steps;
const now = new Date('2026-10-14T12:00:00Z');
const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('demoLines', () => {
  it('hints before a run and echoes the command once one starts', () => {
    expect(demoLines(null, { phase: 'idle' }, steps, now)).toEqual([{ type: 'info', text: landingCopy.demo.hint }]);
    expect(demoLines('octo', { phase: 'working', queued: true, progress: null }, steps, now)).toEqual([
      { type: 'command', text: 'commitmates card octo' },
      { type: 'info', text: toolsCopy.job.queued },
    ]);
  });

  it('ticks finished steps and points at the current one', () => {
    const lines = demoLines('octo', { phase: 'working', queued: false, progress: { step: 'activity' } }, steps, now);
    expect(lines.map((line) => line.type)).toEqual(['command', 'success', 'success', 'info']);
    expect(texts(lines).slice(1)).toEqual(['✓ Finding the account', '✓ Reading repos', '› Reading activity']);
  });

  it('says when GitHub asked us to wait, and how it ended', () => {
    const waiting = demoLines('octo', { phase: 'waiting', until: '2026-10-14T12:03:00Z', progress: { step: 'repos' } }, steps, now);
    expect(waiting.at(-1)).toEqual({ type: 'warn', text: toolsCopy.job.waiting(3) });
    const done = demoLines('octo', { phase: 'done', result: {} }, steps, now);
    expect(done.filter((line) => line.type === 'success')).toHaveLength(steps.length + 1);
    expect(demoLines('octo', { phase: 'error', message: 'Not found.' }, steps, now).at(-1)).toEqual({ type: 'error', text: 'Not found.' });
  });
});

describe('seo', () => {
  it('lists public pages only, every tool included', () => {
    const paths = publicPaths();
    expect(paths).toContain('/');
    expect(paths).toContain('/tools/fyp-check');
    expect(paths).toHaveLength(new Set(paths).size);
    for (const path of paths) expect(PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix))).toBe(false);
  });
});

describe('LiveDemo', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('runs a real Dev Card request and shows the transcript, companion and card', async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(Response.json({ status: 'done', result: sampleDevCard })));
    render(<LiveDemo />);
    expect(screen.getByText(landingCopy.demo.hint)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: ` ${sampleDevCard.login} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => {
      expect(screen.getByTestId('dev-card')).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tools/dev-card');
    const log = screen.getByRole('log');
    expect(within(log).getByText(`commitmates card ${sampleDevCard.login}`)).toBeTruthy();
    expect(within(log).getByText(landingCopy.demo.done)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'The demo companion is done' })).toBeTruthy();
    expect(screen.getByRole('link', { name: landingCopy.demo.fullTool }).getAttribute('href')).toBe(`/tools/dev-card?login=${sampleDevCard.login}`);
    expect(await findA11yViolations(document.body)).toEqual([]);
  });

  it('puts a username error next to the field and in the transcript', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(Response.json({ status: 'error', error: { code: 'tool.invalid_input', message: 'That is not a GitHub username.', field: 'login' } }, { status: 400 })),
    );
    render(<LiveDemo />);
    fireEvent.change(screen.getByLabelText('GitHub username'), { target: { value: '-bad-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => {
      expect(screen.getByLabelText('GitHub username').getAttribute('aria-invalid')).toBe('true');
    });
    expect(within(screen.getByRole('log')).getByText('That is not a GitHub username.')).toBeTruthy();
  });
});
