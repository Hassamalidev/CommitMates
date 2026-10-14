import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { campusUnlocks, creditInvite, getCampus, inviteFor } from './campus';

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

/** A member of `universityId` (verified unless told otherwise) who owns repositories with `topics`. */
async function member(universityId: string, options: { verified?: boolean; role?: string; topics?: string[][] } = {}) {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, role)
                     values (${id}, 'UTC', ${universityId}, ${options.verified === false ? null : new Date()}, ${options.role ?? 'student'})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${600_000 + n}, ${`campus-${n}`})`;
  for (const [index, topics] of (options.topics ?? []).entries()) {
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, topics, is_fork, fetched_at)
                       values (${600_000 * 10 + n * 10 + index}, ${600_000 + n}, ${`campus-${n}/r${index}`}, ${`r${index}`}, ${topics}, false, now())`;
  }
  return { id, verified: options.verified !== false, universityId };
}

beforeAll(async () => {
  database = await useTestDatabase();
  uni = await university('Uni of Testland', 'uni-tl');
  other = await university('Other College', 'other-tl');
  await member(uni, { topics: [['react', 'docker'], ['react']] });
  await member(uni, { topics: [['react']] });
  await member(uni, { role: 'alumni', topics: [['rust']] });
  await member(uni, { verified: false, topics: [['cobol']] });
});
afterAll(async () => {
  await database.destroy();
});

describe('campus unlocks', () => {
  it('counts verified members and alumni, with thresholds read from settings', async () => {
    const progress = await campusUnlocks(uni);
    expect(progress).toMatchObject({ members: 3, alumni: 1 });
    expect(progress.unlocks.find((unlock) => unlock.key === 'matching')).toEqual({ key: 'matching', metric: 'members', current: 3, required: 10, unlocked: false });

    // Changing a setting changes the unlock, with no code change.
    await withSettings({ 'unlock.matching.minMembers': 3, 'unlock.alumni.minAlumni': 2 }, async () => {
      const changed = await campusUnlocks(uni);
      expect(changed.unlocks.find((unlock) => unlock.key === 'matching')).toMatchObject({ required: 3, unlocked: true });
      expect(changed.unlocks.find((unlock) => unlock.key === 'alumni')).toMatchObject({ current: 1, required: 2, unlocked: false });
    });
  });

  it('shows the topics most members use, counting each member once', async () => {
    const campus = await getCampus('uni-tl');
    expect(campus?.topics).toEqual([
      { topic: 'react', members: 2 },
      { topic: 'docker', members: 1 },
      { topic: 'rust', members: 1 },
    ]);
    expect(await getCampus('no-such-uni')).toBeNull();
  });
});

describe('invites', () => {
  it('gives each verified member one code for their own university', async () => {
    const inviter = await member(uni);
    const first = await inviteFor(inviter, uni);
    expect(first?.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await inviteFor(inviter, uni)).toEqual(first);
    expect(await inviteFor(inviter, other)).toBeNull();
    expect(await inviteFor({ ...inviter, verified: false }, uni)).toBeNull();
  });

  it('credits an invite once the invitee is verified at that university, never for oneself', async () => {
    const inviter = await member(uni);
    const { code } = (await inviteFor(inviter, uni))!;
    const invitee = await member(uni);
    const elsewhere = await member(other);

    expect(await creditInvite(elsewhere, { slug: 'uni-tl', code })).toBe(false);
    expect(await creditInvite({ ...invitee, verified: false }, { slug: 'uni-tl', code })).toBe(false);
    expect(await creditInvite(inviter, { slug: 'uni-tl', code })).toBe(false);
    expect(await creditInvite(invitee, { slug: 'uni-tl', code })).toBe(true);
    expect((await inviteFor(inviter, uni))?.uses).toBe(1);
  });
});
