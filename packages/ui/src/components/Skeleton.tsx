import { cn } from '../lib/cn';

export type SkeletonProps = { className?: string };

/** A neutral block shaped like the content it stands in for. No shimmer (CLAUDE.md §9.4). */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn('rounded-control bg-surface-2', className)} />;
}
