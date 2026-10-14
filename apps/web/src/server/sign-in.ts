import 'server-only';

import type { SignInInput } from '@commitmates/core';
import type { Session } from '@supabase/supabase-js';
import { z } from 'zod';

const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com';

// Supabase copies these from GitHub's user object at sign-in.
const metadataSchema = z.object({
  provider_id: z.union([z.string(), z.number()]).optional(),
  sub: z.union([z.string(), z.number()]).optional(),
  user_name: z.string().optional(),
  preferred_username: z.string().optional(),
  full_name: z.string().nullish(),
  name: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

/** GitHub reports the granted scopes; Supabase does not pass them on, so we record the ones we request. */
const REQUESTED_SCOPES = ['read:user', 'user:email'];

/** Builds the sign-in record from a Supabase session, or `null` if it is not a GitHub sign-in. */
export function signInFromSession(session: Session): SignInInput | null {
  const metadata = metadataSchema.safeParse(session.user.user_metadata);
  if (!metadata.success) return null;
  const githubId = Number(metadata.data.provider_id ?? metadata.data.sub);
  const login = metadata.data.user_name ?? metadata.data.preferred_username;
  if (!Number.isSafeInteger(githubId) || githubId <= 0 || !login) return null;

  let avatarUrl: string | null = null;
  try {
    const parsed = new URL(metadata.data.avatar_url ?? '');
    if (parsed.protocol === 'https:' && parsed.hostname === GITHUB_AVATAR_HOST) avatarUrl = parsed.toString();
  } catch {
    avatarUrl = null;
  }

  return {
    userId: session.user.id,
    githubId,
    login,
    name: metadata.data.full_name ?? metadata.data.name ?? null,
    avatarUrl,
    providerToken: session.provider_token ?? null,
    scopes: REQUESTED_SCOPES,
  };
}
