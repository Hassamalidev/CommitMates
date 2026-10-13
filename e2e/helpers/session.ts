import { randomBytes } from 'node:crypto';

import type { BrowserContext } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Signs a browser context in as a freshly created member of the local Supabase stack.
 *
 * GitHub's OAuth screens cannot run in CI, so the session is created with the admin API
 * and written to the same cookies `@supabase/ssr` would set after a real sign-in. The
 * user metadata mirrors what Supabase stores for a GitHub identity.
 */

export type TestMember = { userId: string; login: string; cleanup: () => Promise<void> };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Start the local stack (pnpm db:start) and fill .env.local.`);
  }
  return value;
}

/** Random bytes in generated e2e identifiers. */
const ID_BYTES = 6;

export async function signInTestMember(
  context: BrowserContext,
  baseURL: string,
  options: { login?: string; githubId?: number } = {},
): Promise<TestMember> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const suffix = randomBytes(ID_BYTES).toString('hex');
  const login = options.login ?? `e2e-${suffix}`;
  const githubId = options.githubId ?? 900_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
  const email = `${login}@e2e.test`;
  const password = randomBytes(24).toString('base64url');

  const admin = createClient(supabaseUrl, requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { provider_id: String(githubId), user_name: login, full_name: 'E2E Member' },
  });
  if (created.error) throw created.error;
  const userId = created.data.user.id;

  const jar = new Map<string, string>();
  const browserLike = createServerClient(supabaseUrl, requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const signedIn = await browserLike.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  // Reading the session flushes the pending cookie writes.
  await browserLike.auth.getSession();
  if (jar.size === 0) throw new Error('Supabase did not issue session cookies');

  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));

  return {
    userId,
    login,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
