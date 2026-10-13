import { getLogger } from '@commitmates/core';
import { NextResponse } from 'next/server';

import { safeNextPath } from '@/lib/paths';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirectToPath, siteOrigin } from '@/server/origin';

export const dynamic = 'force-dynamic';

/** The only scopes we ever ask GitHub for (CLAUDE.md §2.7). */
const GITHUB_SCOPES = 'read:user user:email';

/** Starts the GitHub OAuth flow through Supabase Auth. */
export async function GET(request: Request): Promise<Response> {
  const next = safeNextPath(new URL(request.url).searchParams.get('next'), '/home');
  const origin = siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: GITHUB_SCOPES,
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) {
    getLogger().error({ err: error }, 'could not start GitHub sign-in');
    return redirectToPath('/?auth_error=provider');
  }
  return NextResponse.redirect(data.url);
}
