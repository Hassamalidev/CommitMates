'use client';

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

export type TooltipProps = {
  /** Short supplementary text. Never the only place a piece of information lives. */
  content: string;
  /** A focusable element, so keyboard users get the tooltip too. */
  children: ReactNode;
};

const OPEN_DELAY_MS = 200;

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={OPEN_DELAY_MS}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="type-small z-50 max-w-xs rounded-control border border-line-strong bg-surface-2 px-3 py-1.5 text-fg"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
