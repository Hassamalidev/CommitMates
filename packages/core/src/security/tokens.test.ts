import { randomBytes } from 'node:crypto';

import { decrypt, encrypt, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reencryptTokens } from './tokens';

let database: TestDatabase;
let counter = 0;
const oldKey = randomBytes(32).toString('base64');
const newKey = randomBytes(32).toString('base64');
const before = { current: { version: 1, key: oldKey } };
const rotating = { current: { version: 2, key: newKey }, previous: oldKey };

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

async function memberWithToken(tokenEnc: string | null, version: number | null): Promise<string> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  await database.sql`insert into github_identities (user_id, github_id, login, token_enc, token_key_version)
                     values (${id}, ${550_000 + counter}, ${`rotating-${counter}`}, ${tokenEnc}, ${version})`;
  return id;
}

const stored = async (userId: string) =>
  (await database.sql<{ token_enc: string | null; token_key_version: number | null; token_invalid: boolean }[]>`
    select token_enc, token_key_version, token_invalid from github_identities where user_id = ${userId}`)[0]!;

describe('reencryptTokens', () => {
  it('moves every token to the current key, drops one no key can read, and leaves newer ones alone', async () => {
    const a = await memberWithToken(encrypt('gho_first', before), 1);
    const b = await memberWithToken(encrypt('gho_second', before), 1);
    const fresh = await memberWithToken(encrypt('gho_fresh', rotating), 2);
    const broken = await memberWithToken(encrypt('gho_unknown', { current: { version: 1, key: randomBytes(32).toString('base64') } }), 1);
    const none = await memberWithToken(null, null);
    const freshBefore = (await stored(fresh)).token_enc;

    const outcome = await reencryptTokens(null, Date.now() + 60_000, rotating);
    expect(outcome).toMatchObject({ reencrypted: 2, dropped: 1, done: true });
    for (const [userId, plain] of [
      [a, 'gho_first'],
      [b, 'gho_second'],
    ] as const) {
      const row = await stored(userId);
      expect(row.token_key_version).toBe(2);
      expect(row.token_enc?.startsWith('v2.')).toBe(true);
      expect(decrypt(row.token_enc ?? '', { current: { version: 2, key: newKey } })).toBe(plain);
    }
    expect((await stored(fresh)).token_enc).toBe(freshBefore);
    expect(await stored(broken)).toEqual({ token_enc: null, token_key_version: null, token_invalid: true });
    expect(await stored(none)).toMatchObject({ token_enc: null });
    // Nothing is left on the old version.
    expect(await reencryptTokens(null, Date.now() + 60_000, rotating)).toMatchObject({ reencrypted: 0, dropped: 0, done: true });
  });

  it('stops without touching anything when the previous key is missing', async () => {
    const userId = await memberWithToken(encrypt('gho_kept', { current: { version: 5, key: oldKey } }), 5);
    const kept = (await stored(userId)).token_enc;
    await expect(reencryptTokens(null, Date.now() + 60_000, { current: { version: 6, key: newKey } })).rejects.toMatchObject({ code: 'crypto.unknown_key_version' });
    expect((await stored(userId)).token_enc).toBe(kept);
  });

  it('continues where it left off when time runs out', async () => {
    const keys = { current: { version: 8, key: newKey }, previous: oldKey };
    const ids = [await memberWithToken(encrypt('gho_x', { current: { version: 7, key: oldKey } }), 7), await memberWithToken(encrypt('gho_y', { current: { version: 7, key: oldKey } }), 7)];
    const stopped = await reencryptTokens(null, Date.now(), keys);
    expect(stopped).toMatchObject({ reencrypted: 0, done: false });
    const finished = await reencryptTokens(stopped.after, Date.now() + 60_000, keys);
    expect(finished.done).toBe(true);
    for (const id of ids) expect((await stored(id)).token_key_version).toBe(8);
  });
});
