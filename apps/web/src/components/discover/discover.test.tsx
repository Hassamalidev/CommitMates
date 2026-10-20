// @vitest-environment jsdom
import type { DeckCard } from '@commitmates/core';
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverHref, reasonsFor, toCardView } from '@/lib/discover';
import type { ActionResult } from '@/server/action';
import type { AnswerResult } from '@/server/actions/discover';

const answerSuggestionAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<AnswerResult>>>();
const requestFromSuggestionAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<null>>>();
vi.mock('@/server/actions/discover', () => ({ answerSuggestionAction, requestFromSuggestionAction }));

const { DiscoverDeck } = await import('./DiscoverDeck');

const card = (login: string, overrides: Partial<DeckCard> = {}): DeckCard => ({
  suggestionId: `s-${login}`,
  mode: 'study',
  login,
  name: null,
  avatarUrl: null,
  department: 'Computing',
  gradYear: 2027,
  tags: ['react', 'docker'],
  labels: ['nightOwl', 'unknown-label'],
  companion: { seed: 7, speciesKey: 'react', paletteHex: null, stage: 1, traits: [] },
  why: { sharedTags: ['react', 'postgres'], coverage: ['docker'], sharedInterests: 3, window: { startHourUtc: 20, hours: 2 } },
  icebreakers: [{ key: 'sharedTag', value: 'react' }],
  ...overrides,
});

function submitForm(field: HTMLElement) {
  const form = field.closest('form');
  if (!form) throw new Error('expected the field inside a form');
  fireEvent.submit(form);
}

afterEach(() => {
  cleanup();
  answerSuggestionAction.mockReset();
  requestFromSuggestionAction.mockReset();
});

describe('card view', () => {
  it('writes the reasons from real signals, in the member’s timezone', () => {
    expect(reasonsFor(card('sam').why, true, 'Asia/Karachi', new Date('2026-10-20T00:00:00Z'))).toEqual([
      'You both build with react and postgres.',
      "They're strong in docker, which is on your learning list.",
      'You share 3 topics across your repos and stars.',
      'You both often code between 01:00 and 03:00.',
    ]);
    expect(reasonsFor({ sharedTags: [], coverage: ['docker', 'go'], sharedInterests: 1, window: null }, false, 'UTC')).toEqual([
      "They know docker and go, which you haven't used yet.",
      'You share a topic across your repos and stars.',
    ]);
  });

  it('names the person, keeps known labels only, and builds the address with filters', () => {
    const view = toCardView(card('sam', { name: 'Sam Rivera' }), true, 'UTC');
    expect(view).toMatchObject({ name: 'Sam Rivera', details: '@sam · Computing · Class of 2027', labels: ['Night Owl'] });
    expect(toCardView(card('kim', { department: null, gradYear: null }), true, 'UTC')).toMatchObject({ name: '@kim', details: '@kim' });
    expect(discoverHref('teammate', { tag: 'rust', from: 2025, to: undefined, department: '' })).toBe('/discover?mode=teammate&tag=rust&from=2025');
  });
});

describe('DiscoverDeck', () => {
  const views = [toCardView(card('sam'), true, 'UTC'), toCardView(card('kim'), true, 'UTC')];
  const props = {
    cards: views,
    liked: [toCardView(card('lee', { name: 'Lee Park' }), true, 'UTC')],
    firstMessage: { min: 40, max: 4000 },
    empty: <p>Nobody left</p>,
    aside: <p>Filters here</p>,
  };

  it('shows the first card with its actions and the liked list, accessibly', async () => {
    render(
      <main>
        <DiscoverDeck {...props} />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 2, name: '@sam' })).toBeTruthy();
    expect(screen.getByText('1 of 2 today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' }).getAttribute('aria-keyshortcuts')).toBe('ArrowLeft');
    expect(screen.getByRole('button', { name: 'Request chat: Lee Park' })).toBeTruthy();
    expect(await findA11yViolations(document.body)).toEqual([]);
  });

  it('likes with → and announces it', async () => {
    answerSuggestionAction.mockResolvedValueOnce({ ok: true, data: { action: 'liked', login: 'sam' } });
    render(<DiscoverDeck {...props} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(answerSuggestionAction).toHaveBeenCalledOnce();
    });
    const sent = answerSuggestionAction.mock.calls[0]?.[1];
    expect(sent?.get('intent')).toBe('like');
    expect(sent?.get('suggestionId')).toBe('s-sam');
    expect(await screen.findByText("Liked @sam. They're in your liked list for today.")).toBeTruthy();
  });

  it('opens the request dialog with Enter, shows rule errors inline, and closes once sent', async () => {
    requestFromSuggestionAction
      .mockResolvedValueOnce({ ok: false, error: { code: 'chat.first_message_short', message: 'Say a little more.', field: 'message' } })
      .mockResolvedValueOnce({ ok: true, data: null });
    render(<DiscoverDeck {...props} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Message @sam' });
    expect(await findA11yViolations(dialog)).toEqual([]);
    const box = screen.getByLabelText('First message');
    fireEvent.change(box, { target: { value: 'Hi' } });
    submitForm(box);
    expect(await screen.findByText('Say a little more.')).toBeTruthy();
    // While the dialog is open, the arrows type instead of skipping.
    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    expect(answerSuggestionAction).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'Hi Sam, I would like to build a small React project with you this term.' } });
    submitForm(box);
    expect(await screen.findByText("Request sent to @sam. They'll see it with your message.")).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requestFromSuggestionAction.mock.calls[1]?.[1].get('suggestionId')).toBe('s-sam');
  });

  it('sends a suggested opener instead of a typed message', async () => {
    requestFromSuggestionAction.mockResolvedValueOnce({ ok: true, data: null });
    render(<DiscoverDeck {...props} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Message @sam' });
    fireEvent.click(screen.getByRole('radio', { name: 'Hi! I see we both build with react. Want to compare notes, or build something together?' }));
    expect(screen.queryByLabelText('First message')).toBeNull();
    expect(await findA11yViolations(dialog)).toEqual([]);
    const radio = screen.getByRole('radio', { name: 'My own message' });
    submitForm(radio);
    await waitFor(() => {
      expect(requestFromSuggestionAction).toHaveBeenCalledOnce();
    });
    expect(requestFromSuggestionAction.mock.calls[0]?.[1].get('icebreaker')).toBe('sharedTag:react');
  });

  it('shows the empty state when the deck is done', () => {
    render(<DiscoverDeck {...props} cards={[]} />);
    expect(screen.getByText('Nobody left')).toBeTruthy();
  });
});
