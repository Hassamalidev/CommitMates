import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type SpeechBubbleProps = {
  /** One short line (CLAUDE.md §9.1). */
  children: ReactNode;
  /** Which side of the bubble the companion stands on. */
  tail?: 'left' | 'bottom';
  /** Set for job progress so screen readers announce changes politely. */
  live?: boolean;
  className?: string;
};

/** A pixel-bordered bubble attached to a companion: the interface's voice. */
export function SpeechBubble({ children, tail = 'left', live = false, className }: SpeechBubbleProps) {
  return (
    <div
      {...(live ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      className={cn(
        'type-small relative inline-block max-w-xs border-2 border-line-strong bg-surface px-3 py-2 text-fg shadow-pixel',
        className,
      )}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          'absolute size-2 border-line-strong bg-surface',
          tail === 'left' ? 'top-3 -left-[6px] border-b-2 border-l-2' : '-bottom-[6px] left-4 border-r-2 border-b-2',
        )}
      />
    </div>
  );
}
