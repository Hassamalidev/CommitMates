import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { compatShareAllowed } from './sharing';

let database: TestDatabase;

async function member(login: string, githubId: number, visibility: string, status = 'active') {
  const userId = await insertTestUser(database.sql);
  await database.sql`update users set status = ${status}::user_status where id = ${userId}`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${userId}, ${githubId}, ${login})`;
  await database.sql`insert into profiles (user_id, timezone, visibility) values (${userId}, 'UTC', ${visibility}::profile_visibility)`;
}

beforeAll(async () => {
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(async () => {
  await database.sql`truncate users cascade`;
});

describe('compatShareAllowed', () => {
  it('allows sharing when both are public members, whoever is looking', async () => {
    await member('Alice-Dev', 1, 'public');
    await member('bob-dev', 2, 'public');
    expect(await compatShareAllowed('alice-dev', 'BOB-dev', null)).toBe(true);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'someone-else')).toBe(true);
  });

  it('lets one of the two share with a public member, but nobody else', async () => {
    await member('alice-dev', 1, 'university');
    await member('bob-dev', 2, 'public');
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'Alice-Dev')).toBe(true);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'bob-dev')).toBe(false);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', null)).toBe(false);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'carol')).toBe(false);
  });

  it('never shares a comparison with someone who has not signed up', async () => {
    await member('alice-dev', 1, 'public');
    expect(await compatShareAllowed('alice-dev', 'visitor', 'alice-dev')).toBe(false);
    expect(await compatShareAllowed('visitor', 'alice-dev', null)).toBe(false);
  });

  it('respects suspended accounts', async () => {
    await member('alice-dev', 1, 'public', 'suspended');
    await member('bob-dev', 2, 'public');
    expect(await compatShareAllowed('alice-dev', 'bob-dev', null)).toBe(false);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'alice-dev')).toBe(false);
    expect(await compatShareAllowed('alice-dev', 'bob-dev', 'bob-dev')).toBe(false);
  });
});
