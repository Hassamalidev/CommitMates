'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type PopoverProps = {
  /** The element that opens the popover, normally a Button. */
  trigger: ReactNode;
  /** Names the popover for screen readers. */
  label: string;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
};

/** A small non-modal panel anchored to its trigger. Escape or an outside click closes it. */
export function Popover({ trigger, label, children, align = 'center', className }: PopoverProps) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-4 text-fg shadow-pixel',
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
