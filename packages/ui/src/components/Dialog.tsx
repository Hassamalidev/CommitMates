'use client';

import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon';
import { cn } from '../lib/cn';

export type DialogProps = {
  /** The element that opens the dialog, normally a Button. */
  trigger?: ReactNode;
  title: string;
  description?: string;
  /** Accessible name of the close button, e.g. "Close". */
  closeLabel: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
};

/** A modal dialog: focus is trapped inside and returns to the trigger on close. */
export function Dialog({ trigger, title, description, closeLabel, open, onOpenChange, children, className }: DialogProps) {
  return (
    <RadixDialog.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-canvas/80" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'overflow-auto rounded-card border border-line bg-surface p-4 shadow-pixel sm:p-6',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <RadixDialog.Title className="type-h3 text-fg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="type-small text-fg-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              aria-label={closeLabel}
              className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <Icon name="close" />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
