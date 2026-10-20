import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { setMailTransport } from '@commitmates/email';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { getNotificationCenter, getNotificationSettings, markAllRead, unreadNotificationCount, updateNotificationSettings } from './center';

let database: TestDatabase;
let counter = 0;
const sent: { to: string; subject: string; text: string }[] = [];
const sendMail = vi.fn((message: { to: string; subject: string; text: string }) => {
  sent.push(message);
  return Promise.resolve({ messageId: 'm' });
});

type Options = { timezone?: string; digest?: boolean | null; muted?: string[]; email?: boolean };

async function member(options: Options = {}): Promise<{ id: string; email: string }> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const email = `member${counter}@example.com`;
  if (options.email !== false) await database.sql`update auth.users set email = ${email} where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, ${options.timezone ?? 'UTC'}, now())`;
  if (options.digest !== null) {
    await database.sql`insert into notification_prefs (user_id, email_digest, kinds_muted) values (${id}, ${options.digest ?? true}, ${options.muted ?? []})`;
  }
  return { id, email };
}

const notify = (userId: string, kind: string, data: Record<string, string> = {}) =>
  database.sql`insert into notifications (user_id, kind, data) values (${userId}, ${kind}, ${database.sql.json(data)})`;

/** Runs the hourly dispatch with the digest hour set to the current hour in UTC, then the queued digests. */
async function dispatchAt(hourOffset = 0): Promise<void> {
  const hour = (new Date().getUTCHours() + hourOffset + 24) % 24;
  await withSettings({ 'email.digestHourLocal': hour }, async () => {
    const job = await enqueue('digest_email', {}, { idempotencyKey: `dispatch:${Math.random()}` });
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
  });
  const queued = await database.sql<{ id: string }[]>`select id from jobs where type = 'digest_email' and status = 'queued' and payload ? 'userId'`;
  for (const { id } of queued) await runTick({ budgetMs: 30_000, onlyJobId: id });
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  setMailTransport({ sendMail } as never);
});
afterAll(async () => {
  setMailTransport(undefined);
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  sent.length = 0;
  await database.sql`delete from jobs`;
});

describe('notification center', () => {
  it('describes notifications, counts unread without muted kinds, and marks all read', async () => {
    const me = await member({ muted: ['chat_request'] });
    await notify(me.id, 'chat_request', { login: 'sam' });
    await notify(me.id, 'chat_request_accepted', { login: 'kim' });
    await notify(me.id, 'from_a_future_version');
    const items = await getNotificationCenter(me);
    expect(items.map((item) => item.line)).toEqual(['@kim accepted your message request.', '@sam sent you a message request.']);
    expect(await unreadNotificationCount(me)).toBe(2);
    expect(await markAllRead(me)).toBe(3);
    expect(await unreadNotificationCount(me)).toBe(0);
    expect((await getNotificationCenter(me)).every((item) => item.read)).toBe(true);
  });

  it('saves the digest choice and keeps only kinds that may be muted', async () => {
    const me = await member({ digest: null });
    expect(await getNotificationSettings(me)).toMatchObject({ emailDigest: false, kindsMuted: [] });
    await updateNotificationSettings(me, { emailDigest: 'on', muted: ['chat_request', 'account_hidden', 'chat_request'] });
    expect(await getNotificationSettings(me)).toMatchObject({ emailDigest: true, kindsMuted: ['chat_request'] });
  });
});

describe('digest_email', () => {
  it('emails members at their local digest hour, once a day, without muted kinds or repeats', async () => {
    const due = await member({ muted: ['chat_request'] });
    const elsewhere = await member({ timezone: 'Asia/Kolkata' });
    const off = await member({ digest: false });
    for (const person of [due, elsewhere, off]) {
      await notify(person.id, 'chat_request', { login: 'sam' });
      await notify(person.id, 'chat_request_accepted', { login: 'kim', threadId: '9b2e8f9e-3c1a-4d6b-9f0e-1a2b3c4d5e6f' });
    }

    await dispatchAt();
    expect(sent.map((message) => message.to)).toEqual([due.email]);
    expect(sent[0]?.subject).toMatch(/^1 update on /);
    expect(sent[0]?.text).toContain('@kim accepted your message request.');
    expect(sent[0]?.text).not.toContain('@sam');
    const emailed = await database.sql<{ kind: string; emailed_at: Date | null }[]>`select kind, emailed_at from notifications where user_id = ${due.id} order by kind`;
    expect(emailed.map((row) => [row.kind, row.emailed_at !== null])).toEqual([
      ['chat_request', false],
      ['chat_request_accepted', true],
    ]);

    // Nothing new: no second email, even when the dispatch runs again.
    sent.length = 0;
    await dispatchAt();
    expect(sent).toEqual([]);
  });

  it('waits for the next day instead of going over the daily email cap', async () => {
    const capped = await member();
    await notify(capped.id, 'verified_by_vouches');
    await withSettings({ 'email.maxPerDay': 0 }, () => dispatchAt());
    expect(sent).toEqual([]);
    const [job] = await database.sql<{ status: string; run_at: Date }[]>`
      select status, run_at from jobs where type = 'digest_email' and payload->>'userId' = ${capped.id}`;
    expect(job?.status).toBe('queued');
    expect(job!.run_at.getTime()).toBeGreaterThan(Date.now());
    const [row] = await database.sql`select emailed_at from notifications where user_id = ${capped.id}`;
    expect(row?.emailed_at).toBeNull();

    // Once a new day's allowance exists, the waiting digest goes out.
    await database.sql`update jobs set run_at = now() where type = 'digest_email' and payload->>'userId' = ${capped.id}`;
    const [waiting] = await database.sql<{ id: string }[]>`select id from jobs where type = 'digest_email' and payload->>'userId' = ${capped.id}`;
    await runTick({ budgetMs: 30_000, onlyJobId: waiting!.id });
    expect(sent.map((message) => message.to)).toEqual([capped.email]);
  });

  it('skips members without an email address', async () => {
    const quiet = await member({ email: false });
    await notify(quiet.id, 'verified_by_vouches');
    await dispatchAt();
    expect(sent.map((message) => message.to)).not.toContain(quiet.email);
    const [row] = await database.sql`select emailed_at from notifications where user_id = ${quiet.id}`;
    expect(row?.emailed_at).toBeNull();
  });
});
