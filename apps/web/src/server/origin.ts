import 'server-only';

import { clientEnv } from '@commitmates/env/client';

/** The site's own origin, from configuration rather than request headers that a client can forge. */
export function siteOrigin(): string {
  return new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin;
}

/**
 * Route handlers verify `Origin` on POST to stop cross-site form posts (CLAUDE.md §5.10).
 * The request is same-origin when its `Origin` is the configured site, or when its host
 * equals the host the request was addressed to — the same rule Server Actions apply.
 * A browser always sends `Origin` on a cross-site POST and a page cannot forge it.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  if (origin === siteOrigin()) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return requestHost !== null && originHost === requestHost;
}

/** HTTP redirect statuses (protocol constants). */
const TEMPORARY_REDIRECT = 307;
const SEE_OTHER = 303;

/**
 * Redirects to a path on this site with a relative `Location`, so the browser stays on
 * whichever host it used to reach us (production domain, preview URL or localhost).
 * `afterPost` switches the follow-up request to GET.
 */
export function redirectToPath(path: string, options: { afterPost?: boolean } = {}): Response {
  return new Response(null, {
    status: options.afterPost ? SEE_OTHER : TEMPORARY_REDIRECT,
    headers: { Location: path },
  });
}
