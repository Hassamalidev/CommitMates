import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRequest } from '../chat/service';
import { respondToRequest, sendMessage } from '../chat/threads';

import { blockMember, blockedMembers, isBlocking, reportMember, submitFeedback, unblockMember } from './service';

let database: TestDatabase;
let uni: string;
let counter = 0;

const MESSAGE = 'Hi! I saw you build with React and would love to pair on a side project this term.';

async function member(verified = true): Promise<{ id: string; login: string }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `safe-${n}`;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, ${verified ? new Date() : null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${600_000 + n}, ${login})`;
  return { id, login };
}

const statusOf = async (id: string) => (await database.sql<{ status: string }[]>`select status from users where id = ${id}`)[0]?.status;
const report = (from: { id: string }, target: { id: string }, extra: Record<string, unknown> = {}) =>
  reportMember(from, { targetUserId: target.id, reason: 'spam', ...extra });

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('blocks', () => {
  it('blocks a member, ends pending requests between them silently, and can be lifted', async () => {
    const [me, them] = [await member(), await member()];
    const requestId = await createRequest(them.id, { toUserId: me.id, message: MESSAGE, contextKind: 'discover', contextId: null });
    await blockMember(me, { userId: them.id });
    expect(await isBlocking(me, them.id)).toBe(true);
    expect((await blockedMembers(me)).map((entry) => entry.login)).toEqual([them.login]);
    const [row] = await database.sql`select status from message_requests where id = ${requestId}`;
    expect(row?.status).toBe('declined');
    await expect(createRequest(them.id, { toUserId: me.id, message: MESSAGE, contextKind: 'discover', contextId: null })).rejects.toMatchObject({
      code: 'chat.unreachable',
    });
    // Blocking twice is harmless; blocking yourself is not allowed.
    await blockMember(me, { userId: them.id });
    await expect(blockMember(me, { userId: me.id })).rejects.toMatchObject({ code: 'safety.self' });

    await unblockMember(me, { userId: them.id });
    expect(await isBlocking(me, them.id)).toBe(false);
    await expect(unblockMember(me, { userId: them.id })).rejects.toMatchObject({ code: 'safety.not_blocked' });
  });
});

describe('reports and auto-hide', () => {
  it('hides an account once enough distinct verified reporters report it, and audits and tells the member', async () => {
    const target = await member();
    const [a, b, c] = [await member(), await member(), await member()];
    const unverified = await member(false);
    await withSettings({ 'safety.autoHideReports': 3 }, async () => {
      await report(a, target);
      await report(a, target, { reason: 'harassment' });
      await report(unverified, target);
      await report(b, target);
      // Two distinct verified reporters so far: one repeat and one unverified reporter do not count.
      expect(await statusOf(target.id)).toBe('active');
      await report(c, target, { details: 'Sends the same link to everyone.' });
    });
    expect(await statusOf(target.id)).toBe('hidden_pending_review');
    const [audit] = await database.sql`select actor_user_id, data from audit_log where action = 'safety.auto_hidden' and target_id = ${target.id}`;
    expect(audit).toMatchObject({ actor_user_id: null, data: { reporters: 3, threshold: 3 } });
    expect(await database.sql`select 1 from notifications where user_id = ${target.id} and kind = 'account_hidden'`).toHaveLength(1);
  });

  it('does not count dismissed reports or reports older than the window', async () => {
    const target = await member();
    const [a, b, c] = [await member(), await member(), await member()];
    await withSettings({ 'safety.autoHideReports': 2 }, async () => {
      await report(a, target);
      await database.sql`update reports set status = 'dismissed' where reporter = ${a.id}`;
      await report(b, target);
      await database.sql`update reports set created_at = now() - interval '60 days' where reporter = ${b.id}`;
      await report(c, target);
    });
    expect(await statusOf(target.id)).toBe('active');
  });

  it('reports a message only when the reporter can see it and the target wrote it', async () => {
    const [me, them, outsider] = [await member(), await member(), await member()];
    const requestId = await createRequest(them.id, { toUserId: me.id, message: MESSAGE, contextKind: 'discover', contextId: null });
    const { threadId } = await respondToRequest(me, { requestId, accept: true });
    const message = await sendMessage(them, { threadId: threadId!, body: 'Buy my course at https://spam.example' });
    await report(me, them, { messageId: message.id, reason: 'spam' });
    const [row] = await database.sql`select target_message, reason, details from reports where reporter = ${me.id}`;
    expect(row).toMatchObject({ target_message: message.id, reason: 'spam', details: null });

    await expect(report(outsider, them, { messageId: message.id })).rejects.toMatchObject({ code: 'safety.message_missing' });
    await expect(report(them, me, { messageId: message.id })).rejects.toMatchObject({ code: 'safety.message_missing' });
    await expect(report(me, me)).rejects.toMatchObject({ code: 'safety.self' });
    await withSettings({ 'safety.reportDetailsMaxChars': 5 }, async () => {
      await expect(report(me, them, { details: 'far too long' })).rejects.toMatchObject({ code: 'safety.details_long', field: 'details' });
    });
  });
});

describe('feedback', () => {
  it('stores feedback with its page, within the length cap', async () => {
    const me = await member();
    await submitFeedback(me, { page: '/feedback?about=appeal', body: 'The reports about me were a misunderstanding.' });
    const [row] = await database.sql`select page, body from feedback where user_id = ${me.id}`;
    expect(row).toMatchObject({ page: '/feedback?about=appeal' });
    await expect(submitFeedback(me, { page: '/', body: '  ' })).rejects.toMatchObject({ code: 'feedback.empty' });
    await withSettings({ 'feedback.maxChars': 3 }, async () => {
      await expect(submitFeedback(me, { page: '/', body: 'long' })).rejects.toMatchObject({ code: 'feedback.long' });
    });
  });
});
