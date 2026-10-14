import 'server-only';

import { clientEnv } from '@commitmates/env/client';
import { serverEnv } from '@commitmates/env/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase with the secret key, for the few operations only the server may do (deleting an auth
 * user). Never imported by client code (CLAUDE.md §2.7).
 */
export function createSupabaseAdminClient() {
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
