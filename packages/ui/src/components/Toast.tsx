'use client';

import { Toast as RadixToast } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../lib/cn';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastInput = { title: string; description?: string; tone?: ToastTone };

type ToastEntry = ToastInput & { id: number };

const toneStyle: Record<ToastTone, { icon: IconName; color: string }> = {
  info: { icon: 'info', color: 'text-fg-muted' },
  success: { icon: 'check_circle', color: 'text-state-done' },
  error: { icon: 'error', color: 'text-state-error' },
};

/** Milliseconds a toast stays before it dismisses itself. */
const TOAST_DURATION_MS = 6000;

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Returns a function that shows a toast. Must be used under `ToastProvider`. */
export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside ToastProvider');
  return show;
}

export type ToastProviderProps = {
  /** Names the notification region, e.g. "Notifications". */
  label: string;
  /** Accessible name of each toast's dismiss button, e.g. "Dismiss". */
  dismissLabel: string;
  children: ReactNode;
};

/** Hosts toasts in a live region; errors are announced assertively. */
export function ToastProvider({ label, dismissLabel, children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [nextId, setNextId] = useState(1);

  const show = useCallback(
    (toast: ToastInput) => {
      setToasts((current) => [...current, { ...toast, id: nextId }]);
      setNextId((id) => id + 1);
    },
    [nextId],
  );
  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider label={label} duration={TOAST_DURATION_MS} swipeDirection="right">
        {children}
        {toasts.map((toast) => {
          const tone = toneStyle[toast.tone ?? 'info'];
          return (
            <RadixToast.Root
              key={toast.id}
              type={toast.tone === 'error' ? 'foreground' : 'background'}
              onOpenChange={(open) => {
                if (!open) remove(toast.id);
              }}
              className="flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-pixel"
            >
              <Icon name={tone.icon} className={cn('mt-0.5', tone.color)} />
              <div className="min-w-0 flex-1">
                <RadixToast.Title className="type-small font-semibold text-fg">{toast.title}</RadixToast.Title>
                {toast.description ? (
                  <RadixToast.Description className="type-small text-fg-muted">{toast.description}</RadixToast.Description>
                ) : null}
              </div>
              <RadixToast.Close
                aria-label={dismissLabel}
                className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <Icon name="close" size={16} />
              </RadixToast.Close>
            </RadixToast.Root>
          );
        })}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
