/**
 * Whether the browser holds a Supabase auth cookie (`sb-<ref>-auth-token`, possibly split
 * into `.0`, `.1` chunks). Without one there is no session, and the Supabase client is never loaded.
 */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((part) => /^sb-[^=]+-auth-token(?:\.\d+)?=/.test(part.trim()));
}
