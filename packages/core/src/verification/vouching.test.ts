import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canVouchFor, chooseUniversityForVouching, findUniversities, getVouchingStatus, vouchForMember } from './vouching';

const DAY = 24 * 60 * 60 * 1000;
let database: TestDatabase;
let uni: string;
let other: string;
let counter = 0;

async function university(name: string, slug: string): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${name}, ${slug}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  return row!.id;
}

/** A member with a GitHub login; verified at `universityId` `verifiedDaysAgo` days ago, if given. */
async function member(universityId: string | null = null, verifiedDaysAgo: number | null = null): Promise<{ id: string; login: string }> {
  counter += 1;
  // Captured before any await: members created in parallel must not share a number.
  const n = counter;
  const login = `vouch-${n}`;
  const id = await insertTestUser(database.sql);
  const verifiedAt = verifiedDaysAgo === null ? null : new Date(Date.now() - verifiedDaysAgo * DAY);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, ${verifiedAt})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${700_000 + n}, ${login})`;
  return { id, login };
}

beforeAll(async () => {
  database = await useTestDatabase();
  uni = await university('Uni of Testland', 'uni-tl');
  other = await university('Other College 100% Real', 'other-tl');
});
afterAll(async () => {
  await database.destroy();
});

describe('findUniversities', () => {
  it('searches names case-insensitively, treating % and _ literally', async () => {
    expect((await findUniversities('testland')).map((row) => row.name)).toEqual(['Uni of Testland']);
    expect((await findUniversities('100%')).map((row) => row.name)).toEqual(['Other College 100% Real']);
    expect(await findUniversities('%')).toEqual([]);
    expect(await findUniversities('_e')).toEqual([]);
  });
});

describe('vouching', () => {
  it('verifies a member once enough established members of their university vouch', async () => {
    const newcomer = await member();
    const first = await member(uni, 30);
    const second = await member(uni, 8);
    await chooseUniversityForVouching({ id: newcomer.id, verified: false }, { universityId: uni });
    expect(await getVouchingStatus(newcomer.id)).toMatchObject({ universityName: 'Uni of Testland', vouches: 0, required: 2 });
    expect(await canVouchFor(first.id, newcomer.id)).toBe(true);

    expect(await vouchForMember(first, { login: newcomer.login })).toEqual({ vouches: 1, required: 2, verified: false });
    expect(await canVouchFor(first.id, newcomer.id)).toBe(false);
    await expect(vouchForMember(first, { login: newcomer.login })).rejects.toMatchObject({ code: 'vouch.already_vouched' });

    expect(await vouchForMember(second, { login: `@${newcomer.login}` })).toEqual({ vouches: 2, required: 2, verified: true });
    const [profile] = await database.sql`select verified_via, verified_at, university_id from profiles where user_id = ${newcomer.id}`;
    expect(profile).toMatchObject({ verified_via: 'vouch', university_id: uni });
    expect(profile?.verified_at).not.toBeNull();
    const [notification] = await database.sql`select kind from notifications where user_id = ${newcomer.id}`;
    expect(notification?.kind).toBe('verified_by_vouches');
    expect(await database.sql`select delta, reason from credit_ledger where user_id = ${newcomer.id}`).toEqual([{ delta: 1, reason: 'starter' }]);
    // Verified now: nobody needs to vouch any more.
    expect(await getVouchingStatus(newcomer.id)).toBeNull();
  });

  it('only accepts vouches from active members verified at the same university long enough', async () => {
    const newcomer = await member();
    await chooseUniversityForVouching({ id: newcomer.id, verified: false }, { universityId: uni });
    await withSettings({ 'verify.voucherMinDays': 7 }, async () => {
      const recent = await member(uni, 2);
      const elsewhere = await member(other, 30);
      const unverified = await member(uni, null);
      const suspended = await member(uni, 30);
      await database.sql`update users set status = 'suspended' where id = ${suspended.id}`;
      for (const voucher of [recent, elsewhere, unverified, suspended]) {
        expect(await canVouchFor(voucher.id, newcomer.id)).toBe(false);
        await expect(vouchForMember(voucher, { login: newcomer.login })).rejects.toMatchObject({ code: 'vouch.not_eligible' });
      }
      expect(await canVouchFor(newcomer.id, newcomer.id)).toBe(false);
    });
  });

  it('needs a chosen university, and is not for verified members', async () => {
    const established = await member(uni, 30);
    const undecided = await member();
    await expect(vouchForMember(established, { login: undecided.login })).rejects.toMatchObject({ code: 'vouch.not_needed' });
    await expect(vouchForMember(established, { login: 'nobody-at-all' })).rejects.toMatchObject({ code: 'vouch.unknown_member' });
    await expect(chooseUniversityForVouching({ id: established.id, verified: true }, { universityId: other })).rejects.toMatchObject({
      code: 'vouch.already_verified',
    });
  });

  it('verifies exactly once when the last vouches arrive together', async () => {
    const newcomer = await member();
    await chooseUniversityForVouching({ id: newcomer.id, verified: false }, { universityId: uni });
    const [before] = await database.sql<{ member_count: number }[]>`select member_count from universities where id = ${uni}`;
    await withSettings({ 'verify.vouchesRequired': 3 }, async () => {
      const vouchers = await Promise.all([member(uni, 30), member(uni, 30), member(uni, 30), member(uni, 30)]);
      const results = await Promise.all(vouchers.map((voucher) => vouchForMember(voucher, { login: newcomer.login }).catch(() => null)));
      // The profile row lock orders them: the third vouch verifies; the fourth finds nothing to do.
      expect(results.filter((result) => result?.verified)).toHaveLength(1);
      expect(results.filter((result) => result === null)).toHaveLength(1);
    });
    const [after] = await database.sql<{ member_count: number }[]>`select member_count from universities where id = ${uni}`;
    expect(after!.member_count).toBe(before!.member_count + 1);
  });
});
