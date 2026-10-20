import { findA11yViolations } from '@commitmates/config/testing/axe';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { DECK_SHORTCUTS, DeckCard, type DeckAction } from './DeckCard';

function Deck({ onShortcut, enabled = true }: { onShortcut: (action: DeckAction) => void; enabled?: boolean }) {
  return (
    <main>
      <DeckCard
        companion={<span role="img" aria-label="Their companion" />}
        name="Sam Rivera"
        details="@sam · Computing · Class of 2027"
        labels={['Night Owl']}
        tags={['react', 'docker']}
        tagsLabel="Top skills"
        reasons={['You both build with react.']}
        reasonsTitle="Why you might click"
        actions={
          <>
            <Button variant="ghost" aria-keyshortcuts={DECK_SHORTCUTS.skip}>
              Skip
            </Button>
            <Button variant="secondary" aria-keyshortcuts={DECK_SHORTCUTS.like}>
              Like
            </Button>
            <Button aria-keyshortcuts={DECK_SHORTCUTS.request}>Request chat</Button>
          </>
        }
        hints={{ skip: 'Skip', like: 'Like', request: 'Request chat' }}
        hintsLabel="Keyboard:"
        onShortcut={onShortcut}
        shortcutsEnabled={enabled}
      />
      <label>
        Note
        <input />
      </label>
      <label>
        Tag
        <select>
          <option>react</option>
        </select>
      </label>
    </main>
  );
}

describe('DeckCard', () => {
  it('shows the person, their labels, tags, reasons and the shortcut hints, accessibly', async () => {
    const { container } = render(<Deck onShortcut={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Sam Rivera' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sam Rivera' })).toBeInTheDocument();
    expect(screen.getByText('Night Owl')).toBeInTheDocument();
    expect(screen.getByText('You both build with react.')).toBeInTheDocument();
    expect(screen.getByText('←')).toBeInTheDocument();
    expect(screen.getByText('Enter')).toBeInTheDocument();
    expect(await findA11yViolations(container)).toEqual([]);
  });

  it('turns ←, → and Enter into skip, like and request when nothing else wants the key', async () => {
    const onShortcut = vi.fn<(action: DeckAction) => void>();
    render(<Deck onShortcut={onShortcut} />);
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}{Enter}');
    expect(onShortcut.mock.calls.map(([action]) => action)).toEqual(['skip', 'like', 'request']);
  });

  it('leaves keys to fields, select boxes and focused buttons, and to modified presses', async () => {
    const onShortcut = vi.fn();
    render(<Deck onShortcut={onShortcut} />);
    await userEvent.click(screen.getByRole('textbox', { name: 'Note' }));
    await userEvent.keyboard('{ArrowLeft}{Enter}');
    screen.getByRole('combobox', { name: 'Tag' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    // Enter on a focused button presses that button; the arrows still work there.
    screen.getByRole('button', { name: 'Skip' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onShortcut).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowRight}');
    expect(onShortcut).toHaveBeenCalledWith('like');
    onShortcut.mockClear();
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}{Control>}{Enter}{/Control}');
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('ignores shortcuts while disabled', async () => {
    const onShortcut = vi.fn();
    render(<Deck onShortcut={onShortcut} enabled={false} />);
    await userEvent.keyboard('{ArrowLeft}{Enter}');
    expect(onShortcut).not.toHaveBeenCalled();
  });
});
