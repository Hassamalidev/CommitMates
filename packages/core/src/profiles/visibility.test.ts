import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canViewProfile, getProfileOwner, isPublicProfile, profileViewerFor, type ProfileOwner, type ProfileViewer } from './visibility';

const UNI_A = '11111111-1111-4111-8111-111111111111';
const UNI_B = '22222222-2222-4222-8222-222222222222';

const owner = (overrides: Partial<ProfileOwner> = {}): ProfileOwner => ({
  userId: 'owner',
  login: 'owner-login',
  githubId: 1,
  visibility: 'university',
  universityId: UNI_A,
  countryCode: 'TL',
  active: true,
  ...overrides,
});
const viewer = (overrides: Partial<ProfileViewer> = {}): ProfileViewer => ({ id: 'viewer', universityId: UNI_A, verified: true, countryCode: 'TL', ...overrides });

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
    // Being in the same country does not widen university visibility.
    expect(canViewProfile(owner(), viewer({ universityId: UNI_B }))).toBe(false);
  });

  it('limits country visibility to verified members in the same country', () => {
    const inCountry = owner({ visibility: 'country' });
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B }))).toBe(true);
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B, countryCode: 'XX' }))).toBe(false);
    expect(canViewProfile(inCountry, viewer({ universityId: UNI_B, verified: false }))).toBe(false);
    expect(canViewProfile(inCountry, null)).toBe(false);
    // The same university always counts; a missing country never matches.
    expect(canViewProfile(inCountry, viewer({ countryCode: null }))).toBe(true);
    expect(canViewProfile(owner({ visibility: 'country', countryCode: null }), viewer({ universityId: UNI_B, countryCode: null }))).toBe(false);
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
      countryCode: null,
      active: true,
    });
    expect(await getProfileOwner('someone-else')).toBeNull();

    await database.sql`update users set status = 'suspended' where id = ${userId}`;
    expect((await getProfileOwner('FIXTURE-USER-1'))?.active).toBe(false);
  });

  it('carries the country of the owner’s university, and gives viewers theirs', async () => {
    const [uni] = await database.sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values ('Visibility Uni', 'visibility-uni', 'Testland', 'TL', '{}', 'admin', 'v') returning id`;
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, 4243, 'country-owner')`;
    await database.sql`insert into profiles (user_id, timezone, visibility, university_id) values (${userId}, 'UTC', 'country', ${uni!.id})`;
    expect((await getProfileOwner('country-owner'))?.countryCode).toBe('TL');
    expect(await profileViewerFor({ id: 'v', universityId: uni!.id, verified: true })).toEqual({ id: 'v', universityId: uni!.id, verified: true, countryCode: 'TL' });
    expect((await profileViewerFor({ id: 'w', universityId: null, verified: false })).countryCode).toBeNull();
  });
});
