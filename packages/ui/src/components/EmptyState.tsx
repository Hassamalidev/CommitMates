import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type EmptyStateProps = {
  /** The companion in its idle state (CLAUDE.md §9.4). */
  companion?: ReactNode;
  title: string;
  /** One line: what is missing and how it unlocks. */
  description: string;
  action?: ReactNode;
  className?: string;
};

/** What a page shows instead of an empty list: never a blank screen (CLAUDE.md §2.4). */
export function EmptyState({ companion, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      {companion}
      <p className="type-h3 text-fg">{title}</p>
      <p className="type-body max-w-reading text-fg-muted">{description}</p>
      {action}
    </div>
  );
}
