import { deleteMemberData, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRequest } from './service';
import { deleteMessage, editMessage, getConversation, getInbox, leaveThread, markRead, muteThread, respondToRequest, sendMessage, unreadCount } from './threads';

let database: TestDatabase;
let uni: string;
let counter = 0;

const MESSAGE = 'Hi! I saw you build with React and would love to pair on a side project this term.';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

type Person = { id: string; login: string };

async function member(): Promise<Person> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `chat-${n}`;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login, name) values (${id}, ${500_000 + n}, ${login}, ${`Person ${n}`})`;
  return { id, login };
}

const request = (from: Person, to: Person, now = new Date()) =>
  createRequest(from.id, { toUserId: to.id, message: MESSAGE, contextKind: 'discover', contextId: null }, now);

/** Two members with an accepted request and the thread it opened. */
async function pair(): Promise<{ a: Person; b: Person; threadId: string }> {
  const [a, b] = [await member(), await member()];
  const requestId = await request(a, b);
  const { threadId } = await respondToRequest(b, { requestId, accept: true });
  if (!threadId) throw new Error('expected a thread');
  return { a, b, threadId };
}

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

describe('message requests', () => {
  it('tells the recipient, and accepting opens a thread with the first message, a connection and a note to the sender', async () => {
    const [a, b] = [await member(), await member()];
    const requestId = await request(a, b);
    const [received] = await database.sql`select kind, data from notifications where user_id = ${b.id}`;
    expect(received).toMatchObject({ kind: 'chat_request', data: { login: a.login, context: 'discover' } });

    const inbox = await getInbox(b);
    expect(inbox.incoming.map((entry) => ({ id: entry.id, from: entry.from.login }))).toEqual([{ id: requestId, from: a.login }]);
    expect((await getInbox(a)).outgoing).toMatchObject([{ id: requestId, status: 'pending', to: { login: b.login } }]);

    const { threadId } = await respondToRequest(b, { requestId, accept: true });
    const conversation = await getConversation(b, threadId!, null);
    expect(conversation.members.map((entry) => entry.login).sort()).toEqual([a.login, b.login].sort());
    expect(conversation.messages).toMatchObject([{ authorUserId: a.id, kind: 'user', body: MESSAGE }]);
    const [a1, b1] = [a.id, b.id].sort();
    expect(await database.sql`select source from connections where user_a = ${a1!} and user_b = ${b1!}`).toEqual([{ source: 'match' }]);
    const [accepted] = await database.sql`select data from notifications where user_id = ${a.id} and kind = 'chat_request_accepted'`;
    expect(accepted?.data).toMatchObject({ login: b.login, threadId });
    expect((await getInbox(a)).outgoing[0]?.status).toBe('accepted');
    // Answered requests cannot be answered again, and only the recipient can answer.
    await expect(respondToRequest(b, { requestId, accept: false })).rejects.toMatchObject({ code: 'chat.request_gone' });
  });

  it('answers a crossing request too, and reuses the thread two people already share', async () => {
    const [a, b] = [await member(), await member()];
    const first = await request(a, b);
    const crossing = await request(b, a);
    const { threadId } = await respondToRequest(b, { requestId: first, accept: true });
    const [row] = await database.sql`select status from message_requests where id = ${crossing}`;
    expect(row?.status).toBe('accepted');

    // A later request between them lands in the same thread.
    const later = await request(a, b);
    const again = await respondToRequest(b, { requestId: later, accept: true });
    expect(again.threadId).toBe(threadId);
    expect((await getConversation(a, threadId!, null)).messages).toHaveLength(2);
  });

  it('declines silently: the sender still sees pending until it expires', async () => {
    const [a, b, c] = [await member(), await member(), await member()];
    const requestId = await request(a, b);
    await expect(respondToRequest(c, { requestId, accept: true })).rejects.toMatchObject({ code: 'chat.request_gone' });
    expect(await respondToRequest(b, { requestId, accept: false })).toEqual({ threadId: null });
    expect((await getInbox(a)).outgoing[0]?.status).toBe('pending');
    expect((await getInbox(b)).incoming).toEqual([]);
    expect(await database.sql`select 1 from notifications where user_id = ${a.id} and kind = 'chat_request_accepted'`).toHaveLength(0);
  });

  it('expires requests after chat.requestTtlDays, and an expired one no longer blocks a new request', async () => {
    const [a, b] = [await member(), await member()];
    const old = new Date(Date.now() - 20 * DAY);
    const requestId = await request(a, b, old);
    await database.sql`update message_requests set created_at = ${old} where id = ${requestId}`;
    expect((await getInbox(b)).incoming).toEqual([]);
    await expect(respondToRequest(b, { requestId, accept: true })).rejects.toMatchObject({ code: 'chat.request_gone' });
    const [row] = await database.sql`select status from message_requests where id = ${requestId}`;
    expect(row?.status).toBe('expired');
    await expect(request(a, b)).resolves.toEqual(expect.any(String));
  });

  it('cannot be accepted once either side has blocked the other', async () => {
    const [a, b] = [await member(), await member()];
    const requestId = await request(a, b);
    await database.sql`insert into blocks (blocker, blocked) values (${a.id}, ${b.id})`;
    expect((await getInbox(b)).incoming).toEqual([]);
    await expect(respondToRequest(b, { requestId, accept: true })).rejects.toMatchObject({ code: 'chat.unreachable' });
  });
});

describe('messages', () => {
  it('lets members post, counts unread for the others, and clears it when they read', async () => {
    const { a, b, threadId } = await pair();
    await sendMessage(a, { threadId, body: '  Great, when are you free?  ' });
    await sendMessage(a, { threadId, body: 'Tomorrow works for me.' });
    expect(await unreadCount(b)).toBe(2);
    expect(await unreadCount(a)).toBe(0);
    const [summary] = (await getInbox(b)).threads.filter((thread) => thread.id === threadId);
    expect(summary).toMatchObject({ unread: 2, others: [{ login: a.login }], lastMessage: { body: 'Tomorrow works for me.' } });

    await markRead(b, { threadId });
    expect(await unreadCount(b)).toBe(0);
    const outsider = await member();
    await expect(sendMessage(outsider, { threadId, body: 'hello' })).rejects.toMatchObject({ code: 'chat.thread_missing' });
    await expect(sendMessage(a, { threadId, body: '   ' })).rejects.toMatchObject({ code: 'chat.message_empty' });
  });

  it('refuses messages when either side has blocked the other, or the sender is not active', async () => {
    const { a, b, threadId } = await pair();
    await database.sql`insert into blocks (blocker, blocked) values (${b.id}, ${a.id})`;
    await expect(sendMessage(a, { threadId, body: 'Still there?' })).rejects.toMatchObject({ code: 'chat.unreachable' });
    await database.sql`delete from blocks where blocker = ${b.id}`;
    await database.sql`update users set status = 'suspended' where id = ${a.id}`;
    await expect(sendMessage(a, { threadId, body: 'Still there?' })).rejects.toMatchObject({ code: 'chat.unreachable' });
  });

  it('applies the length cap and the link cap for new accounts', async () => {
    const { a, threadId } = await pair();
    await withSettings({ 'chat.maxMessageChars': 10 }, async () => {
      await expect(sendMessage(a, { threadId, body: 'x'.repeat(11) })).rejects.toMatchObject({ code: 'chat.message_long' });
    });
    await database.sql`update users set created_at = now() where id = ${a.id}`;
    await expect(sendMessage(a, { threadId, body: 'https://a.dev and https://b.dev' })).rejects.toMatchObject({ code: 'chat.too_many_links' });
  });

  it('edits only the author’s own message within the edit window, and deletes it', async () => {
    const { a, b, threadId } = await pair();
    const sent = await sendMessage(a, { threadId, body: 'See you at 5' });
    const edited = await editMessage(a, { messageId: sent.id, body: 'See you at 6' }, new Date(sent.createdAt.getTime() + 5 * MINUTE));
    expect(edited).toMatchObject({ body: 'See you at 6', editedAt: expect.any(Date) });
    await expect(editMessage(b, { messageId: sent.id, body: 'hacked' })).rejects.toMatchObject({ code: 'chat.message_missing' });
    await expect(editMessage(a, { messageId: sent.id, body: 'late' }, new Date(sent.createdAt.getTime() + 11 * MINUTE))).rejects.toMatchObject({
      code: 'chat.edit_window',
    });

    await expect(deleteMessage(b, { messageId: sent.id })).rejects.toMatchObject({ code: 'chat.message_missing' });
    await deleteMessage(a, { messageId: sent.id });
    const [row] = await database.sql`select body, deleted_at from messages where id = ${sent.id}`;
    expect(row).toMatchObject({ body: '', deleted_at: expect.any(Date) });
    await expect(editMessage(a, { messageId: sent.id, body: 'back' })).rejects.toMatchObject({ code: 'chat.message_missing' });
  });

  it('pages back through a conversation with a cursor', async () => {
    const { a, b, threadId } = await pair();
    for (let index = 0; index < 4; index += 1) await sendMessage(a, { threadId, body: `message ${index}` });
    await withSettings({ 'chat.messagesPerPage': 2 }, async () => {
      const latest = await getConversation(b, threadId, null);
      expect(latest.messages.map((message) => message.body)).toEqual(['message 2', 'message 3']);
      expect(latest.before).not.toBeNull();
      const earlier = await getConversation(b, threadId, latest.before);
      expect(earlier.messages.map((message) => message.body)).toEqual(['message 0', 'message 1']);
      const first = await getConversation(b, threadId, earlier.before);
      expect(first.messages).toHaveLength(1);
      expect(first.before).toBeNull();
    });
    await expect(getConversation(await member(), threadId, null)).rejects.toMatchObject({ code: 'chat.thread_missing' });
    await expect(getConversation(b, 'not-a-thread', null)).rejects.toMatchObject({ code: 'chat.thread_missing' });
    // An edited cursor opens the newest page.
    expect(await getConversation(b, threadId, { createdAt: 'yesterday', id: 'x' })).toMatchObject({ latest: true });
  });

  it('mutes a thread out of the unread total, and leaving leaves a note for the others', async () => {
    const { a, b, threadId } = await pair();
    await sendMessage(a, { threadId, body: 'ping' });
    await muteThread(b, { threadId, muted: true });
    expect(await unreadCount(b)).toBe(0);
    await muteThread(b, { threadId, muted: false });
    expect(await unreadCount(b)).toBe(1);

    await leaveThread(b, { threadId });
    const conversation = await getConversation(a, threadId, null);
    expect(conversation.members.map((entry) => entry.login)).toEqual([a.login]);
    expect(conversation.messages.at(-1)).toMatchObject({ kind: 'system', body: `left:${b.login}`, authorUserId: null });
    await expect(leaveThread(b, { threadId })).rejects.toMatchObject({ code: 'chat.thread_missing' });
  });

  it('replaces a deleted member’s messages with one note, and removes threads only they were in', async () => {
    const { a, b, threadId } = await pair();
    await sendMessage(b, { threadId, body: 'my words' });
    const solo = await database.sql<{ id: string }[]>`insert into threads (kind) values ('group') returning id`;
    await database.sql`insert into thread_members (thread_id, user_id) values (${solo[0]!.id}, ${b.id})`;

    await deleteMemberData(b.id, new Date());
    const rows = await database.sql<{ author_user_id: string | null; kind: string; body: string }[]>`
      select author_user_id, kind, body from messages where thread_id = ${threadId} order by created_at`;
    expect(rows.some((row) => row.author_user_id === b.id)).toBe(false);
    expect(rows.at(-1)).toMatchObject({ author_user_id: null, kind: 'system', body: 'member_left' });
    // The first message was a's; it stays.
    expect(rows[0]).toMatchObject({ author_user_id: a.id, body: MESSAGE });
    expect(await database.sql`select 1 from threads where id = ${solo[0]!.id}`).toHaveLength(0);
  });
});
