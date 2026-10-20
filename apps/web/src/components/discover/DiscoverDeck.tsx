'use client';

import { Button, CompanionView, DECK_SHORTCUTS, DeckCard, type DeckAction } from '@commitmates/ui';
import Link from 'next/link';
import { useActionState, useCallback, useRef, useState, type ReactNode } from 'react';

import { discoverCopy } from '@/copy/discover';
import type { DeckCardView } from '@/lib/discover';
import { answerSuggestionAction } from '@/server/actions/discover';

import { RequestDialog } from './RequestDialog';

export type DiscoverDeckProps = {
  cards: readonly DeckCardView[];
  liked: readonly DeckCardView[];
  firstMessage: { min: number; max: number };
  /** Shown instead of a card when the deck is empty. */
  empty: ReactNode;
  /** The filters, shown beside the deck. */
  aside: ReactNode;
};

type Target = { suggestionId: string; login: string };

/**
 * Today's deck, one card at a time (CLAUDE.md §8 F11 "UI"), with Skip and Like as a native form
 * (they work without JavaScript), Request chat in a dialog, and today's liked list beside it.
 */
export function DiscoverDeck({ cards, liked, firstMessage, empty, aside }: DiscoverDeckProps) {
  const [answer, answerAction, answering] = useActionState(answerSuggestionAction, null);
  const [target, setTarget] = useState<Target | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const likeRef = useRef<HTMLButtonElement>(null);
  const copy = discoverCopy;
  const card = cards[0];

  const onShortcut = useCallback(
    (action: DeckAction) => {
      if (!card) return;
      if (action === 'skip') skipRef.current?.click();
      else if (action === 'like') likeRef.current?.click();
      else setTarget({ suggestionId: card.suggestionId, login: card.login });
    },
    [card],
  );

  const announcement = sentTo
    ? copy.request.sent(sentTo)
    : answer?.ok
      ? answer.data.action === 'liked'
        ? copy.actions.liked(answer.data.login)
        : copy.actions.skipped(answer.data.login)
      : '';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <p role="status" className="type-small min-h-6 text-state-done">
          {announcement}
        </p>
        {answer && !answer.ok ? (
          <p role="alert" className="type-small text-state-error">
            {answer.error.message}
          </p>
        ) : null}
        {card ? (
          <>
            <p className="type-small text-fg-muted">{copy.card.count(1, cards.length)}</p>
            <DeckCard
              key={card.suggestionId}
              companion={<CompanionView companion={card.companion} state="idle" size={96} label={copy.card.companionLabel(card.login)} />}
              name={card.name}
              details={card.details}
              labels={card.labels}
              tags={card.tags}
              tagsLabel={copy.card.tagsLabel}
              reasons={card.reasons}
              reasonsTitle={copy.card.reasonsTitle}
              hints={{ skip: copy.actions.skip, like: copy.actions.like, request: copy.actions.request }}
              hintsLabel={copy.actions.hintsLabel}
              onShortcut={onShortcut}
              shortcutsEnabled={!answering && target === null}
              actions={
                <>
                  <form
                    action={answerAction}
                    className="contents"
                    onSubmit={() => {
                      setSentTo(null);
                    }}
                  >
                    <input type="hidden" name="suggestionId" value={card.suggestionId} />
                    <input type="hidden" name="login" value={card.login} />
                    <Button ref={skipRef} type="submit" name="intent" value="skip" variant="ghost" disabled={answering} aria-keyshortcuts={DECK_SHORTCUTS.skip}>
                      {copy.actions.skip}
                    </Button>
                    <Button ref={likeRef} type="submit" name="intent" value="like" variant="secondary" disabled={answering} aria-keyshortcuts={DECK_SHORTCUTS.like}>
                      {copy.actions.like}
                    </Button>
                  </form>
                  <Button
                    type="button"
                    disabled={answering}
                    aria-keyshortcuts={DECK_SHORTCUTS.request}
                    onClick={() => {
                      setTarget({ suggestionId: card.suggestionId, login: card.login });
                    }}
                  >
                    {copy.actions.request}
                  </Button>
                  <Link href={`/u/${encodeURIComponent(card.login)}`} className="type-small inline-flex min-h-11 items-center px-2 text-fg-muted underline hover:text-fg">
                    {copy.card.profileLink}
                  </Link>
                </>
              }
            />
          </>
        ) : (
          empty
        )}
      </div>
      <div className="flex flex-col gap-6">
        {aside}
        <section aria-labelledby="liked-title" className="rounded-card border border-line bg-surface p-4">
          <h2 id="liked-title" className="type-h3">
            {copy.liked.title}
          </h2>
          {liked.length === 0 ? (
            <p className="type-small mt-2 text-fg-muted">{copy.liked.empty}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {liked.map((person) => (
                <li key={person.suggestionId} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-small min-w-0 break-words">{person.name}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${copy.actions.request}: ${person.name}`}
                    onClick={() => {
                      setTarget({ suggestionId: person.suggestionId, login: person.login });
                    }}
                  >
                    {copy.actions.request}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {target ? (
        <RequestDialog
          key={target.suggestionId}
          suggestionId={target.suggestionId}
          login={target.login}
          limits={firstMessage}
          onClose={() => {
            setTarget(null);
          }}
          onSent={(login) => {
            setTarget(null);
            setSentTo(login);
          }}
        />
      ) : null}
    </div>
  );
}
