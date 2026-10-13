/** Path prefixes of the members area and admin (CLAUDE.md §5.11). Everything else is public. */
export const PROTECTED_PREFIXES = [
  '/onboarding',
  '/home',
  '/discover',
  '/inbox',
  '/streaks',
  '/reviews',
  '/swaps',
  '/legacy',
  '/uni',
  '/leaderboards',
  '/alumni',
  '/events',
  '/fyp',
  '/settings',
  '/admin',
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Where to send someone after signing in. Only same-site paths are accepted, so a
 * crafted link cannot redirect to another origin.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  // Control characters and encoded slashes have no place in an internal path.
  if (/\p{Cc}/u.test(next) || /%2f|%5c/i.test(next)) return fallback;
  return next;
}
