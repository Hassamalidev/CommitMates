import { decrypt } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SignInInput } from './schemas';
import { completeSignIn, ensureMemberRows, getMember, hasRole } from './service';

let database: TestDatabase;

beforeAll(async () => {
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});

async function authUser(): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`insert into auth.users default values returning id`;
  return row!.id;
}

const signIn = (userId: string, overrides: Partial<SignInInput> = {}): SignInInput => ({
  userId,
  githubId: 5000 + Math.floor(Math.random() * 1_000_000),
  login: `member-${userId.slice(0, 8)}`,
  name: 'A Member',
  avatarUrl: 'https://avatars.githubusercontent.com/u/5000?v=4',
  providerToken: 'gho_plaintext-token-value',
  scopes: ['read:user', 'user:email'],
  ...overrides,
});

describe('completeSignIn', () => {
  it('creates the member, profile and identity with the token encrypted', async () => {
    const userId = await authUser();
    const result = await completeSignIn(signIn(userId, { githubId: 777 }));
    expect(result).toEqual({ isNewMember: true, grantedAdmin: false });

    const [identity] = await database.sql`select * from github_identities where user_id = ${userId}`;
    expect(identity).toMatchObject({
      github_id: '777',
      token_key_version: 1,
      token_invalid: false,
      scopes: ['read:user', 'user:email'],
    });
    expect(identity!.token_enc).toMatch(/^v1\./);
    expect(identity!.token_enc).not.toContain('gho_plaintext');
    expect(decrypt(identity!.token_enc)).toBe('gho_plaintext-token-value');

    const [profile] = await database.sql`select timezone, verified_at from profiles where user_id = ${userId}`;
    expect(profile).toEqual({ timezone: 'UTC', verified_at: null });

    // The plaintext token is nowhere in the row.
    expect(JSON.stringify(identity)).not.toContain('gho_plaintext-token-value');
  });

  it('updates the token on a later sign-in and clears the invalid flag', async () => {
    const userId = await authUser();
    await completeSignIn(signIn(userId, { githubId: 778 }));
    await database.sql`update github_identities set token_invalid = true where user_id = ${userId}`;

    const result = await completeSignIn(signIn(userId, { githubId: 778, login: 'renamed', providerToken: 'gho_second' }));
    expect(result.isNewMember).toBe(false);
    const [identity] = await database.sql`select login, token_enc, token_invalid from github_identities where user_id = ${userId}`;
    expect(identity).toMatchObject({ login: 'renamed', token_invalid: false });
    expect(decrypt(identity!.token_enc)).toBe('gho_second');
  });

  it('keeps the stored token when a sign-in carries none', async () => {
    const userId = await authUser();
    await completeSignIn(signIn(userId, { githubId: 779 }));
    await completeSignIn(signIn(userId, { githubId: 779, providerToken: null }));
    const [identity] = await database.sql`select token_enc from github_identities where user_id = ${userId}`;
    expect(decrypt(identity!.token_enc)).toBe('gho_plaintext-token-value');
  });

  it('grants admin to the bootstrap account once, with an audit entry', async () => {
    const userId = await authUser();
    // The test environment sets BOOTSTRAP_ADMIN_GITHUB_ID=1.
    expect(await completeSignIn(signIn(userId, { githubId: 1 }))).toMatchObject({ grantedAdmin: true });
    expect(await completeSignIn(signIn(userId, { githubId: 1 }))).toMatchObject({ grantedAdmin: false });

    const granted = await database.sql`select role from roles where user_id = ${userId}`;
    expect(granted).toEqual([{ role: 'admin' }]);
    const audit = await database.sql`
      select action, actor_user_id from audit_log where target_type = 'user' and target_id = ${userId}`;
    expect(audit).toEqual([{ action: 'role.bootstrap_admin', actor_user_id: null }]);
  });

  it('rejects malformed input', async () => {
    await expect(completeSignIn(signIn('not-a-uuid'))).rejects.toThrow();
  });
});

describe('getMember', () => {
  it('returns null for an unknown user', async () => {
    expect(await getMember('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('describes identity, verification and roles', async () => {
    const userId = await authUser();
    await completeSignIn(signIn(userId, { githubId: 880, login: 'ada' }));
    let member = await getMember(userId);
    expect(member).toMatchObject({
      id: userId,
      login: 'ada',
      githubId: 880,
      status: 'active',
      hasValidToken: true,
      verified: false,
      onboarded: false,
      roles: [],
    });

    const [university] = await database.sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values ('Test University', 'test-university-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
    const universityId = university!.id;
    await database.sql`update profiles set university_id = ${universityId}, verified_at = now(), onboarded_at = now()
                       where user_id = ${userId}`;
    await database.sql`insert into roles (user_id, role, university_id) values (${userId}, 'uni_moderator', ${universityId})`;
    await database.sql`update github_identities set token_invalid = true where user_id = ${userId}`;

    member = await getMember(userId);
    expect(member).toMatchObject({ verified: true, onboarded: true, hasValidToken: false, universityId });
    expect(member!.roles).toEqual([{ role: 'uni_moderator', universityId }]);
  });

  it('works for a session that never reached the callback', async () => {
    const userId = await authUser();
    await ensureMemberRows(userId);
    await ensureMemberRows(userId);
    expect(await getMember(userId)).toMatchObject({ login: null, githubId: null, hasValidToken: false, timezone: 'UTC' });
  });
});

describe('hasRole', () => {
  const uni = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';

  it('lets admins pass every check', () => {
    const admin = { roles: [{ role: 'admin' as const, universityId: null }] };
    expect(hasRole(admin, 'admin')).toBe(true);
    expect(hasRole(admin, { role: 'uni_moderator', universityId: uni })).toBe(true);
  });

  it('scopes moderators to their university', () => {
    const moderator = { roles: [{ role: 'uni_moderator' as const, universityId: uni }] };
    expect(hasRole(moderator, { role: 'uni_moderator', universityId: uni })).toBe(true);
    expect(hasRole(moderator, { role: 'uni_moderator', universityId: other })).toBe(false);
    expect(hasRole(moderator, 'admin')).toBe(false);
  });

  it('denies members without roles', () => {
    expect(hasRole({ roles: [] }, 'admin')).toBe(false);
  });
});
