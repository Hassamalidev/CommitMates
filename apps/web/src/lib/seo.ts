import { AVAILABLE_TOOLS, toolPath } from './tools';

/** Pages anyone may read and search engines may list. */
const SITE_PAGES = ['/', '/privacy', '/terms', '/attribution'] as const;

/**
 * Paths crawlers are asked to skip: APIs, sign-in, admin and the members area
 * (CLAUDE.md §4.1 route groups). Pages there also set `noindex` or require a session.
 */
export const PRIVATE_PREFIXES = [
  '/api/',
  '/auth/',
  '/admin',
  '/onboarding',
  '/home',
  '/discover',
  '/inbox',
  '/streaks',
  '/reviews',
  '/swaps',
  '/legacy',
  '/uni/',
  '/leaderboards',
  '/alumni',
  '/events',
  '/fyp',
  '/settings',
] as const;

/** Every public page, for the sitemap. */
export function publicPaths(): string[] {
  return [...SITE_PAGES, ...[...AVAILABLE_TOOLS].map(toolPath)];
}
