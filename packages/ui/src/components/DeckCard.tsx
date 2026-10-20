'use client';

import { useEffect, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export type DeckAction = 'skip' | 'like' | 'request';

/** KeyboardEvent keys for the deck's shortcuts (CLAUDE.md §9.4 `DeckCard`). */
const SHORTCUT_KEYS: Readonly<Record<string, DeckAction>> = { ArrowLeft: 'skip', ArrowRight: 'like', Enter: 'request' };
/** What each key looks like in the visible hint. */
const KEY_LABELS: Readonly<Record<DeckAction, string>> = { skip: '←', like: '→', request: 'Enter' };
/** The `aria-keyshortcuts` value for each action, for the caller's buttons. */
export const DECK_SHORTCUTS: Readonly<Record<DeckAction, string>> = { skip: 'ArrowLeft', like: 'ArrowRight', request: 'Enter' };

/** Places where a key already means something: typing, choosing, or an open dialog. */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="menu"]';
/** Enter also activates buttons and links, so it is left to them when they have focus. */
const OWN_ENTER = `${OWN_KEYS}, button, a, summary`;

/** The deck action a key press asks for, or null when the key belongs to something else. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'defaultPrevented' | 'target'>): DeckAction | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const action = SHORTCUT_KEYS[event.key];
  if (!action) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(action === 'request' ? OWN_ENTER : OWN_KEYS)) return null;
  return action;
}

export type DeckCardProps = {
  /** The person's companion, normally a `CompanionView`. */
  companion: ReactNode;
  name: string;
  /** One line under the name, e.g. "@login · Computing · Class of 2027". */
  details?: string;
  labels: readonly string[];
  tags: readonly string[];
  tagsLabel: string;
  /** Plain-language reasons this person is suggested. */
  reasons: readonly string[];
  reasonsTitle: string;
  /** The Skip, Like and Request controls, in that order; give them `aria-keyshortcuts` from `DECK_SHORTCUTS`. */
  actions: ReactNode;
  /** Visible hint text per action, e.g. "Skip". */
  hints: Readonly<Record<DeckAction, string>>;
  hintsLabel: string;
  /** Called for ← (skip), → (like) and Enter (request) when the page has no other use for the key. */
  onShortcut?: (action: DeckAction) => void;
  /** Off while an action is in flight or a dialog is open. */
  shortcutsEnabled?: boolean;
  className?: string;
};

/**
 * One suggestion on Discover (CLAUDE.md §9.4): companion, name, labels, tags, the "why" lines and
 * the actions, with keyboard shortcuts shown next to them.
 */
export function DeckCard({
  companion,
  name,
  details,
  labels,
  tags,
  tagsLabel,
  reasons,
  reasonsTitle,
  actions,
  hints,
  hintsLabel,
  onShortcut,
  shortcutsEnabled = true,
  className,
}: DeckCardProps) {
  useEffect(() => {
    if (!onShortcut || !shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      onShortcut(action);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onShortcut, shortcutsEnabled]);

  return (
    <article aria-label={name} className={cn('flex flex-col gap-5 rounded-card border border-line bg-surface p-4 shadow-pixel sm:p-6', className)}>
      <header className="flex items-center gap-4">
        <div className="shrink-0">{companion}</div>
        <div className="min-w-0">
          <h2 className="type-h2 break-words text-fg">{name}</h2>
          {details ? <p className="type-small break-words text-fg-muted">{details}</p> : null}
        </div>
      </header>
      {labels.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {labels.map((label) => (
            <li key={label} className="type-small rounded-full border border-accent px-3 py-0.5 font-semibold text-fg">
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {tags.length > 0 ? (
        <div>
          <h3 className="type-small font-semibold text-fg-muted">{tagsLabel}</h3>
          <ul className="mt-1 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag} className="type-small rounded-full border border-line bg-surface-2 px-3 py-0.5 text-fg">
                {tag}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reasons.length > 0 ? (
        <div>
          <h3 className="type-small font-semibold text-fg-muted">{reasonsTitle}</h3>
          <ul className="type-body mt-1 flex list-disc flex-col gap-1 pl-5 text-fg">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">{actions}</div>
      {onShortcut ? (
        <p className="type-small flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-muted">
          <span>{hintsLabel}</span>
          {(['skip', 'like', 'request'] as const).map((action) => (
            <span key={action} className="inline-flex items-center gap-1">
              <kbd className="type-code rounded-control border border-line bg-surface-2 px-1.5">{KEY_LABELS[action]}</kbd>
              {hints[action]}
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}
