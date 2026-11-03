import { clientEnv } from '@commitmates/env/client';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { NONCE_HEADER, contentSecurityPolicy, createNonce } from '@/lib/csp';
import { INVITE_COOKIE, inviteCookieValue } from '@/lib/invite-cookie';
import { isProtectedPath } from '@/lib/paths';

/**
 * Runs before matched requests: sets this request's Content-Security-Policy with a fresh nonce
 * (CLAUDE.md §5.10; Next reads the nonce from the request header and puts it on its own scripts),
 * refreshes the Supabase session cookies and keeps signed-out visitors out of the members area and
 * admin (§5.11). Role and verification checks happen server-side in the guards; this is only the
 * first gate.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = createNonce();
  const policy = contentSecurityPolicy({ nonce, supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL, development: process.env.NODE_ENV === 'development' });
  request.headers.set(NONCE_HEADER, nonce);
  request.headers.set('content-security-policy', policy);
  const withPolicy = (next: NextResponse) => {
    next.headers.set('content-security-policy', policy);
    return next;
  };
  let response = withPolicy(NextResponse.next({ request }));

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = withPolicy(NextResponse.next({ request }));
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Must run on every matched request: it rotates expiring tokens.
  const { data } = await supabase.auth.getUser();

  // An invite link (`?ref=<uni-slug>&invite=<code>`) is remembered for this browsing session, so the
  // inviter is credited once the visitor signs up and verifies there (CLAUDE.md §1.4).
  const invite = inviteCookieValue(request.nextUrl.searchParams.get('ref'), request.nextUrl.searchParams.get('invite'));
  if (invite) {
    response.cookies.set(INVITE_COOKIE, invite, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/' });
  }

  if (!data.user && isProtectedPath(request.nextUrl.pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/auth/sign-in';
    signIn.search = '';
    signIn.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return withPolicy(NextResponse.redirect(signIn));
  }
  return response;
}

export const config = {
  // Skip static assets, images and the routes that authenticate by other means.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/jobs/tick|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)'],
};
