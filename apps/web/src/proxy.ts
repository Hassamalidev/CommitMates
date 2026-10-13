import { clientEnv } from '@commitmates/env/client';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isProtectedPath } from '@/lib/paths';

/**
 * Runs before matched requests: refreshes the Supabase session cookies and keeps
 * signed-out visitors out of the members area and admin (CLAUDE.md §5.11). Role and
 * verification checks happen server-side in the guards; this is only the first gate.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Must run on every matched request: it rotates expiring tokens.
  const { data } = await supabase.auth.getUser();

  if (!data.user && isProtectedPath(request.nextUrl.pathname)) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/auth/sign-in';
    signIn.search = '';
    signIn.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  // Skip static assets, images and the routes that authenticate by other means.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/jobs/tick|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)'],
};
