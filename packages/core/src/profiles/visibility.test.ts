import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canViewProfile, getProfileOwner, isPublicProfile, type ProfileOwner, type ProfileViewer } from './visibility';

const UNI_A = '11111111-1111-4111-8111-111111111111';
const UNI_B = '22222222-2222-4222-8222-222222222222';

const owner = (overrides: Partial<ProfileOwner> = {}): ProfileOwner => ({
  userId: 'owner',
  login: 'owner-login',
  githubId: 1,
  visibility: 'university',
  universityId: UNI_A,
  active: true,
  ...overrides,
});
const viewer = (overrides: Partial<ProfileViewer> = {}): ProfileViewer => ({ id: 'viewer', universityId: UNI_A, verified: true, ...overrides });

describe('canViewProfile', () => {
  it('always lets members see their own page', () => {
    for (const visibility of ['university', 'country', 'public', 'hidden'] as const) {
      expect(canViewProfile(owner({ visibility, active: false }), viewer({ id: 'owner', verified: false }))).toBe(true);
    }
  });

  it('shows a public profile to anyone, signed in or not', () => {
    expect(canViewProfile(owner({ visibility: 'public' }), null)).toBe(true);
    expect(canViewProfile(owner({ visibility: 'public' }), viewer({ verified: false, universityId: null }))).toBe(true);
  });

  it('shows a hidden profile to nobody else', () => {
    expect(canViewProfile(owner({ visibility: 'hidden' }), null)).toBe(false);
    expect(canViewProfile(owner({ visibility: 'hidden' }), viewer())).toBe(false);
  });

  it('limits university visibility to verified members of the same university', () => {
    expect(canViewProfile(owner(), viewer())).toBe(true);
    expect(canViewProfile(owner(), viewer({ universityId: UNI_B }))).toBe(false);
    expect(canViewProfile(owner(), viewer({ verified: false }))).toBe(false);
    expect(canViewProfile(owner(), null)).toBe(false);
    // Two members without a university do not share one.
    expect(canViewProfile(owner({ universityId: null }), viewer({ universityId: null }))).toBe(false);
    // The country flag does not widen university visibility.
    expect(canViewProfile(owner(), viewer({ universityId: UNI_B }), true)).toBe(false);
  });

  it('limits country visibility to verified members in the same country', () => {
    const inCountry = owner({ visibility: 'country' });
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B }), true)).toBe(true);
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B }), false)).toBe(false);
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B, verified: false }), true)).toBe(false);
    expect(canViewProfile(inCountry, null, true)).toBe(false);
    // Without country data, the same university is the only certain match.
    expect(canViewProfile(inCountry, viewer())).toBe(true);
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B }))).toBe(false);
  });

  it('hides suspended and under-review accounts from everyone else', () => {
    expect(canViewProfile(owner({ visibility: 'public', active: false }), viewer())).toBe(false);
    expect(canViewProfile(owner({ visibility: 'public', active: false }), null)).toBe(false);
  });
});

describe('isPublicProfile', () => {
  it('is true only for active members with public visibility', () => {
    expect(isPublicProfile(owner({ visibility: 'public' }))).toBe(true);
    expect(isPublicProfile(owner({ visibility: 'public', active: false }))).toBe(false);
    expect(isPublicProfile(owner({ visibility: 'country' }))).toBe(false);
  });
});

describe('getProfileOwner', () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await useTestDatabase();
  });
  afterAll(async () => {
    await database.destroy();
  });

  it('finds a member by login without regard to case, and nobody else', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, 4242, 'Fixture-User-1')`;
    await database.sql`insert into profiles (user_id, timezone, visibility) values (${userId}, 'UTC', 'public')`;

    expect(await getProfileOwner('fixture-user-1')).toEqual({
      userId,
      login: 'Fixture-User-1',
      githubId: 4242,
      visibility: 'public',
      universityId: null,
      active: true,
    });
    expect(await getProfileOwner('someone-else')).toBeNull();

    await database.sql`update users set status = 'suspended' where id = ${userId}`;
    expect((await getProfileOwner('FIXTURE-USER-1'))?.active).toBe(false);
  });
});
