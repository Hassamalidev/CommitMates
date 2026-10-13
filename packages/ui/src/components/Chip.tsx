import type { HTMLAttributes, ReactNode } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../lib/cn';

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { children: ReactNode };

/** A neutral pill for tags, labels and counts. */
export function Chip({ className, children, ...rest }: ChipProps) {
  return (
    <span
      {...rest}
      className={cn(
        'type-small inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-0.5 text-fg',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The five states every job and companion can be in (CLAUDE.md §5.14). */
export type CompanionState = 'idle' | 'working' | 'waiting' | 'done' | 'error';

const stateStyle: Record<CompanionState, { icon: IconName; color: string }> = {
  idle: { icon: 'schedule', color: 'text-state-idle border-state-idle' },
  working: { icon: 'progress_activity', color: 'text-state-working border-state-working' },
  waiting: { icon: 'hourglass_top', color: 'text-state-waiting border-state-waiting' },
  done: { icon: 'check_circle', color: 'text-state-done border-state-done' },
  error: { icon: 'error', color: 'text-state-error border-state-error' },
};

export type StateChipProps = { state: CompanionState; label: string; className?: string };

/** Icon + label in the state's color. The label carries the meaning; the icon is decorative. */
export function StateChip({ state, label, className }: StateChipProps) {
  const style = stateStyle[state];
  return (
    <span
      data-state={state}
      className={cn(
        'type-small inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-0.5 font-semibold',
        style.color,
        className,
      )}
    >
      <Icon name={style.icon} size={16} />
      {label}
    </span>
  );
}
