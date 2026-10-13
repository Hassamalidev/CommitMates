/** Priority classes (CLAUDE.md §5.4). Higher runs first. */
export const PRIORITY = {
  /** A user is waiting on screen. */
  INTERACTIVE: 100,
  /** Member background work: vectors, verification follow-ups, review checks. */
  USER_BG: 50,
  /** Syncs, recompute, purges, digests. */
  MAINTENANCE: 20,
  /** Country crawler. */
  CRAWL: 0,
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];
