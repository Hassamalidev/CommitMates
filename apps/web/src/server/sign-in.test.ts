import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { signInFromSession } from './sign-in';

const session = (metadata: Record<string, unknown>, providerToken: string | null = 'gho_token'): Session =>
  ({
    provider_token: providerToken,
    user: { id: '3d0c1b1e-1111-4111-8111-000000000001', user_metadata: metadata },
  }) as unknown as Session;

describe('signInFromSession', () => {
  it('reads the GitHub identity Supabase stored', () => {
    expect(
      signInFromSession(
        session({
          provider_id: '583231',
          user_name: 'octocat',
          full_name: 'The Octocat',
          avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4',
        }),
      ),
    ).toEqual({
      userId: '3d0c1b1e-1111-4111-8111-000000000001',
      githubId: 583231,
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
      providerToken: 'gho_token',
      scopes: ['read:user', 'user:email'],
    });
  });

  it('falls back to sub and preferred_username, and tolerates a missing token', () => {
    const result = signInFromSession(session({ sub: 42, preferred_username: 'ada' }, null));
    expect(result).toMatchObject({ githubId: 42, login: 'ada', name: null, avatarUrl: null, providerToken: null });
  });

  it('drops avatar URLs that are not GitHub avatars', () => {
    const result = signInFromSession(
      session({ provider_id: '1', user_name: 'a', avatar_url: 'https://evil.example/x.png' }),
    );
    expect(result?.avatarUrl).toBeNull();
  });

  it('rejects sessions without a GitHub identity', () => {
    expect(signInFromSession(session({}))).toBeNull();
    expect(signInFromSession(session({ provider_id: 'abc', user_name: 'a' }))).toBeNull();
    expect(signInFromSession(session({ provider_id: '5' }))).toBeNull();
  });
});
