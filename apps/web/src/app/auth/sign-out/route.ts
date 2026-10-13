import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSameOrigin, redirectToPath } from '@/server/origin';

export const dynamic = 'force-dynamic';

/** HTTP status for a refused cross-site post (protocol constant). */
const FORBIDDEN = 403;

/** Ends the session. POST only, with an origin check, so a link or image cannot sign someone out. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: 'forbidden' }, { status: FORBIDDEN });
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return redirectToPath('/', { afterPost: true });
}
