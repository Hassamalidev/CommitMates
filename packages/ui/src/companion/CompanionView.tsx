'use client';

import { useEffect, useState } from 'react';

import { CompanionSprite } from './CompanionSprite';
import { STATE_TIMING, type CompanionInput, type CompanionState } from './generate';

export type CompanionViewProps = {
  companion: CompanionInput;
  state: CompanionState;
  size?: 64 | 96 | 160 | 240;
  /**
   * Text alternative including the state, e.g. "Your companion is working". Omit only
   * when the companion is decoration next to text that already says the same thing.
   */
  label?: string;
  className?: string;
};

/**
 * A Commitling that reacts to state changes: "done" hops twice, then settles to idle
 * (CLAUDE.md §9.5). Drawing is `CompanionSprite`; use that directly for a companion whose
 * state never changes, so server components render it without shipping work to the browser.
 */
export function CompanionView({ companion, state, size = 96, label, className }: CompanionViewProps) {
  // "Done" plays its hop twice, then the companion settles back to idle (CLAUDE.md §9.5).
  const [hopFinished, setHopFinished] = useState(false);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    // A new state always starts fresh, so a second "done" hops again.
    setPreviousState(state);
    setHopFinished(false);
  }
  const visibleState: CompanionState = state === 'done' && hopFinished ? 'idle' : state;

  const { durationMs, iterations } = STATE_TIMING[visibleState];

  // A timer, not `animationend`: with reduced motion the animation never runs, and the
  // companion must still come to rest.
  useEffect(() => {
    if (state !== 'done' || hopFinished || iterations === null) return;
    const timer = setTimeout(() => {
      setHopFinished(true);
    }, durationMs * iterations);
    return () => {
      clearTimeout(timer);
    };
  }, [state, hopFinished, durationMs, iterations]);

  return <CompanionSprite companion={companion} state={visibleState} size={size} label={label} className={className} />;
}
