import { completeSignIn, getLogger } from '@commitmates/core';
import { safeNextPath } from '@/lib/paths';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirectToPath } from '@/server/origin';
import { signInFromSession } from '@/server/sign-in';

export const dynamic = 'force-dynamic';

/**
 * GitHub → Supabase → here. Exchanges the code for a session, captures the provider
 * token (stored encrypted) and upserts the member (CLAUDE.md §8 F10 step 1).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const failure = redirectToPath('/?auth_error=sign_in');
  const code = url.searchParams.get('code');
  if (!code) return failure;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    getLogger().warn({ err: error }, 'OAuth code exchange failed');
    return failure;
  }

  const signIn = signInFromSession(data.session);
  if (!signIn) {
    getLogger().warn('session has no GitHub identity; signing out');
    await supabase.auth.signOut();
    return failure;
  }

  try {
    const result = await completeSignIn(signIn);
    const next = safeNextPath(url.searchParams.get('next'), '/home');
    // New members start with onboarding; the members area sends them there anyway.
    return redirectToPath(result.isNewMember ? '/onboarding' : next);
  } catch (error_) {
    getLogger().error({ err: error_ }, 'could not complete sign-in');
    await supabase.auth.signOut();
    return failure;
  }
}
