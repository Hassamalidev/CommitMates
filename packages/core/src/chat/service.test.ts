import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRequest } from './service';

let database: TestDatabase;
let uni: string;
let otherUni: string;

const MESSAGE = 'Hi! I saw you build with React and would love to pair on a side project this term.';
const NOW = new Date();

type Options = { university?: string; verified?: boolean; ghost?: boolean; status?: string; ageDays?: number };

async function member(options: Options = {}): Promise<string> {
  const id = await insertTestUser(database.sql);
  const created = new Date(NOW.getTime() - (options.ageDays ?? 30) * 24 * 60 * 60 * 1000);
  await database.sql`update users set created_at = ${created}, status = ${options.status ?? 'active'} where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, ghost_mode)
                     values (${id}, 'UTC', ${options.university ?? uni}, ${options.verified === false ? null : NOW}, ${options.ghost ?? false})`;
  return id;
}

const request = (from: string, to: string, message = MESSAGE) =>
  createRequest(from, { toUserId: to, message, contextKind: 'discover', contextId: null }, NOW);

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x'), ('Other', 'other-tl', 'Testland', 'TL', '{}', 'admin', 'y') returning id`;
  uni = rows[0]!.id;
  otherUni = rows[1]!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('createRequest', () => {
  it('stores a pending request with its context and refuses a second one to the same person', async () => {
    const [from, to] = [await member(), await member()];
    const id = await request(from, to);
    const [row] = await database.sql`select from_user, to_user, context_kind, first_message, status from message_requests where id = ${id}`;
    expect(row).toMatchObject({ from_user: from, to_user: to, context_kind: 'discover', first_message: MESSAGE, status: 'pending' });
    await expect(request(from, to)).rejects.toMatchObject({ code: 'chat.request_pending' });
    // The other direction is a separate request.
    await expect(request(to, from)).resolves.toEqual(expect.any(String));
  });

  it('refuses requests to yourself, from unverified members, and to people who cannot be reached', async () => {
    const me = await member();
    await expect(request(me, me)).rejects.toMatchObject({ code: 'chat.self' });
    await expect(request(await member({ verified: false }), me)).rejects.toMatchObject({ code: 'chat.sender_not_verified' });
    for (const target of [
      await member({ ghost: true }),
      await member({ verified: false }),
      await member({ status: 'suspended' }),
      await member({ university: otherUni }),
    ]) {
      await expect(request(me, target)).rejects.toMatchObject({ code: 'chat.unreachable' });
    }
  });

  it('refuses when either side blocked the other', async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    await database.sql`insert into blocks (blocker, blocked) values (${b}, ${a}), (${a}, ${c})`;
    await expect(request(a, b)).rejects.toMatchObject({ code: 'chat.unreachable' });
    await expect(request(a, c)).rejects.toMatchObject({ code: 'chat.unreachable' });
    expect(await database.sql`select 1 from message_requests where from_user = ${a}`).toHaveLength(0);
  });

  it('checks the first message length and the link cap for new accounts', async () => {
    const [old, fresh, to] = [await member(), await member({ ageDays: 1 }), await member()];
    await expect(request(old, to, 'hey')).rejects.toMatchObject({ code: 'chat.first_message_short', field: 'message' });
    await withSettings({ 'chat.maxMessageChars': 100 }, async () => {
      await expect(request(old, to, 'x'.repeat(101))).rejects.toMatchObject({ code: 'chat.message_long' });
    });
    const links = `${MESSAGE} https://github.com/a/b and https://example.dev`;
    await expect(request(fresh, to, links)).rejects.toMatchObject({ code: 'chat.too_many_links' });
    await expect(request(fresh, to, `${MESSAGE} https://github.com/a/b`)).resolves.toEqual(expect.any(String));
    await expect(request(old, to, links)).resolves.toEqual(expect.any(String));
  });

  it('limits new requests a day by the base limit times the trust multiplier', async () => {
    const sender = await member();
    const targets = await Promise.all(Array.from({ length: 4 }, () => member()));
    await withSettings({ 'chat.newThreadsPerDay.base': 3 }, async () => {
      // A multiplier of 0.5 makes round(1.5) = 2 requests a day.
      await database.sql`insert into trust_scores (user_id, score, multiplier, components, computed_at) values (${sender}, 0, 0.5, '{}', now())`;
      await request(sender, targets[0]!);
      await request(sender, targets[1]!);
      await expect(request(sender, targets[2]!)).rejects.toMatchObject({ code: 'chat.daily_limit', status: 429 });
      // Without a trust score yet the base limit applies.
      await database.sql`delete from trust_scores where user_id = ${sender}`;
      await expect(request(sender, targets[2]!)).resolves.toEqual(expect.any(String));
      await expect(request(sender, targets[3]!)).rejects.toMatchObject({ code: 'chat.daily_limit' });
    });
  });

  it('counts requests sent at the same moment one after the other', async () => {
    const sender = await member();
    const targets = await Promise.all(Array.from({ length: 5 }, () => member()));
    await withSettings({ 'chat.newThreadsPerDay.base': 2 }, async () => {
      const results = await Promise.allSettled(targets.map((target) => request(sender, target)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    });
  });
});
