import { renderStill } from '@commitmates/ui';

import { brandCompanion } from '@/lib/brand';

export const dynamic = 'force-static';

/** Seconds browsers and CDNs may keep the icon: one day. */
const MAX_AGE_SECONDS = 86_400;

/** The site icon: the brand companion, generated like every other one (CLAUDE.md §2.10). */
export function GET(): Response {
  // A mid-tone backdrop keeps the outline visible on light and dark browser chrome.
  const svg = renderStill(brandCompanion, { surfaceHex: '#151923', accentHex: '#7cff6b' });
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}`,
    },
  });
}
