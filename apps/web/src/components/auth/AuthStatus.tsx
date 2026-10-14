'use client';

import { useEffect, useState } from 'react';

import { authCopy } from '@/copy/auth';
import { hasSessionCookie } from '@/lib/session-cookie';

type Signed = { login: string | null };

/** The GitHub login in the session's user metadata, as the sign-in callback reads it. */
function loginFrom(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.user_name ?? metadata?.preferred_username;
  return typeof value === 'string' ? value : null;
}

/**
 * Sign-in link for visitors; identity and sign-out for members. It runs in the browser so
 * public pages can be served static: visitors see the link straight away and never load
 * the Supabase client; a member's name replaces it once the session is read. Server
 * actions and guards still verify the session themselves; this only decides what to show.
 */
export function AuthStatus() {
  const [signed, setSigned] = useState<Signed | null>(null);

  useEffect(() => {
    if (!hasSessionCookie(document.cookie)) return;
    let active = true;
    void import('@/lib/supabase/browser')
      .then(({ createSupabaseBrowserClient }) => createSupabaseBrowserClient().auth.getSession())
      .then(({ data }) => {
        if (active && data.session) setSigned({ login: loginFrom(data.session.user.user_metadata) });
      })
      // A session that cannot be read shows the sign-in link, which is the safe default.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!signed) {
    return (
      <a className="text-accent underline underline-offset-4" href="/auth/sign-in">
        {authCopy.signIn}
      </a>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="auth-status">
      <span>{signed.login ? authCopy.signedInAs(signed.login) : authCopy.signedIn}</span>
      <form action="/auth/sign-out" method="post">
        <button className="text-accent underline underline-offset-4" type="submit">
          {authCopy.signOut}
        </button>
      </form>
    </div>
  );
}
