import { clientEnv } from '@commitmates/env/client';
import { createBrowserClient } from '@supabase/ssr';

/** Supabase client in the browser, reading the session from the auth cookies. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
