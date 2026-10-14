import { z } from 'zod';

import { CLIENT_FALLBACKS } from './public';
import { lazyEnv, parseEnv, type EnvSource } from './shared';

export const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientSchema>;

// Next.js inlines `process.env.NEXT_PUBLIC_*` only when each variable is referenced literally.
const readClientSource = (): EnvSource => ({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

/**
 * Browser-safe variables. The site name and URL fall back to local values so a build
 * without `.env.local` still compiles; `assertServerEnv()` requires the real ones at startup.
 */
export const clientEnv = lazyEnv('client', clientSchema, readClientSource, CLIENT_FALLBACKS);

export function parseClientEnv(source: EnvSource = readClientSource()): ClientEnv {
  return parseEnv('client', clientSchema, source);
}
