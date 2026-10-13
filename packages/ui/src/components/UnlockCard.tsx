import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon';
import { cn } from '../lib/cn';

export type UnlockCardProps = {
  title: string;
  /** One sentence on what unlocks. */
  description: string;
  current: number;
  /** Always read from settings by the caller, never hardcoded (CLAUDE.md §1.4). */
  required: number;
  /** e.g. "14 / 20 verified members" */
  progressLabel: string;
  /** The invite action, normally a button that copies a link with `?ref=<uni-slug>`. */
  action?: ReactNode;
  className?: string;
};

/** Shown instead of a locked feature: progress toward the unlock and a way to help it along. */
export function UnlockCard({ title, description, current, required, progressLabel, action, className }: UnlockCardProps) {
  const max = Math.max(required, 1);
  const value = Math.min(Math.max(current, 0), max);
  const percent = (value / max) * 100;

  return (
    <section className={cn('rounded-card border border-line bg-surface p-4 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <span className="rounded-control bg-surface-2 p-2 text-fg-muted">
          <Icon name="lock" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="type-h3 text-fg">{title}</h3>
          <p className="type-body text-fg-muted">{description}</p>
        </div>
      </div>
      <div className="mt-4">
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={progressLabel}
          className="h-3 overflow-hidden rounded-full border border-line bg-surface-2"
        >
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <p className="type-small mt-2 text-fg-muted">{progressLabel}</p>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
