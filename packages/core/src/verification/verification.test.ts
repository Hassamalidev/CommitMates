import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { setMailTransport } from '@commitmates/email';
import { runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { confirmEmailCode, startEmailVerification } from './service';

const sent: { to: string; text: string }[] = [];
const sendMail = vi.fn((message: { to: string; text: string }) => {
  sent.push(message);
  return Promise.resolve({ messageId: 'm' });
});
let database: TestDatabase;
let uni: string;
let other: string;

async function university(name: string, slug: string, domain: string): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${name}, ${slug}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  await database.sql`insert into university_domains (domain, university_id) values (${domain}, ${row!.id})`;
  return row!.id;
}

async function member(): Promise<string> {
  const userId = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'UTC')`;
  return userId;
}

/** Starts verification, runs the queued send, and returns the code from the email. */
async function requestCode(userId: string, email: string, now = new Date()): Promise<string> {
  const result = await startEmailVerification(userId, { email }, now);
  if (result.status !== 'sent') throw new Error(`expected sent, got ${result.status}`);
  await runTick({ budgetMs: 30_000, onlyJobId: result.jobId });
  const code = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? '')?.[1];
  if (!code) throw new Error('no code in the email');
  return code;
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  setMailTransport({ sendMail } as never);
  uni = await university('Uni of Testland', 'uni-tl', 'uni.edu');
  other = await university('Other College', 'other-tl', 'other.edu');
  await database.sql`insert into disposable_domains (domain, synced_at) values ('mailinator.com', now())`;
});
afterAll(async () => {
  setMailTransport(undefined);
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  sent.length = 0;
  await database.sql`truncate email_daily_counts, jobs`;
});

describe('startEmailVerification', () => {
  it('rejects malformed and disposable addresses, and reports unknown domains', async () => {
    const userId = await member();
    await expect(startEmailVerification(userId, { email: 'not-an-email' })).rejects.toMatchObject({ code: 'verify.invalid_email', field: 'email' });
    await expect(startEmailVerification(userId, { email: 'ada@inbox.mailinator.com' })).rejects.toMatchObject({ code: 'verify.disposable' });
    expect(await startEmailVerification(userId, { email: 'ada@unknown.edu' })).toEqual({ status: 'unknown', domain: 'unknown.edu' });
    expect(sent).toHaveLength(0);
  });

  it('emails a six-digit code to a subdomain address, storing only its hash', async () => {
    const userId = await member();
    const code = await requestCode(userId, 'Ada@CS.Uni.edu');
    expect(sent.at(-1)?.to).toBe('ada@cs.uni.edu');
    expect(sent.at(-1)?.text).toContain('Uni of Testland');
    const rows = await database.sql`select code_hash, email, domain, expires_at from email_verifications where user_id = ${userId}`;
    expect(rows[0]).toMatchObject({ email: 'ada@cs.uni.edu', domain: 'cs.uni.edu' });
    expect(JSON.stringify(rows)).not.toContain(code);
    const jobs = await database.sql`select payload, result_ref, last_error from jobs`;
    expect(JSON.stringify(jobs)).not.toContain(code);
  });

  it(`allows verify.maxSendsPerDay codes a day`, async () => {
    const userId = await member();
    await withSettings({ 'verify.maxSendsPerDay': 2 }, async () => {
      await requestCode(userId, 'ada@uni.edu');
      await requestCode(userId, 'ada@uni.edu');
      await expect(startEmailVerification(userId, { email: 'ada@uni.edu' })).rejects.toMatchObject({ code: 'verify.send_limit', status: 429 });
      // The next UTC day starts a new count.
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await expect(requestCode(userId, 'ada@uni.edu', tomorrow)).resolves.toMatch(/^\d{6}$/);
    });
  });
});

describe('confirmEmailCode', () => {
  it('verifies the member, forgets the address and counts the member at the university', async () => {
    const userId = await member();
    const code = await requestCode(userId, 'ada@uni.edu');
    expect(await confirmEmailCode(userId, { code })).toEqual({ universityId: uni });

    const [profile] = await database.sql`select university_id, verified_via, verified_at from profiles where user_id = ${userId}`;
    expect(profile).toMatchObject({ university_id: uni, verified_via: 'email' });
    expect(profile?.verified_at).not.toBeNull();
    const [row] = await database.sql`select email, code_hash, domain, verified_at from email_verifications where user_id = ${userId}`;
    expect(row).toMatchObject({ email: null, code_hash: null, domain: 'uni.edu' });
    const [count] = await database.sql`select member_count from universities where id = ${uni}`;
    expect(count?.member_count).toBeGreaterThanOrEqual(1);
    // Nothing is pending any more.
    await expect(confirmEmailCode(userId, { code })).rejects.toMatchObject({ code: 'verify.no_pending' });
    // New verified members get their review starter credits once.
    expect(await database.sql`select delta, reason from credit_ledger where user_id = ${userId}`).toEqual([{ delta: 1, reason: 'starter' }]);
  });

  it('moves the member count when a member verifies at another university', async () => {
    const userId = await member();
    await confirmEmailCode(userId, { code: await requestCode(userId, 'ada@uni.edu') });
    const [before] = await database.sql<{ member_count: number }[]>`select member_count from universities where id = ${uni}`;
    await confirmEmailCode(userId, { code: await requestCode(userId, 'ada@other.edu') });
    // Re-verifying elsewhere grants no more starter credits.
    expect(await database.sql`select reason from credit_ledger where user_id = ${userId}`).toEqual([{ reason: 'starter' }]);
    const counts = await database.sql<{ id: string; member_count: number }[]>`select id, member_count from universities where id in (${uni}, ${other})`;
    expect(counts.find((row) => row.id === uni)?.member_count).toBe(before!.member_count - 1);
    expect(counts.find((row) => row.id === other)?.member_count).toBe(1);
  });

  it('counts wrong guesses, then locks the code after verify.maxAttempts', async () => {
    const userId = await member();
    await withSettings({ 'verify.maxAttempts': 3 }, async () => {
      const code = await requestCode(userId, 'ada@uni.edu');
      const wrong = code === '000000' ? '111111' : '000000';
      await expect(confirmEmailCode(userId, { code: wrong })).rejects.toMatchObject({ code: 'verify.wrong_code', userMessage: expect.stringContaining('2 tries left') as string });
      await expect(confirmEmailCode(userId, { code: wrong })).rejects.toMatchObject({ userMessage: expect.stringContaining('One try left') as string });
      await expect(confirmEmailCode(userId, { code: wrong })).rejects.toMatchObject({ code: 'verify.locked' });
      // Even the right code no longer works; a new code is needed.
      await expect(confirmEmailCode(userId, { code })).rejects.toMatchObject({ code: 'verify.locked' });
      const fresh = await requestCode(userId, 'ada@uni.edu');
      await expect(confirmEmailCode(userId, { code: fresh })).resolves.toEqual({ universityId: uni });
    });
  });

  it('rejects an expired code and badly formed input', async () => {
    const userId = await member();
    const code = await requestCode(userId, 'ada@uni.edu');
    const later = new Date(Date.now() + 11 * 60 * 1000);
    await expect(confirmEmailCode(userId, { code }, later)).rejects.toMatchObject({ code: 'verify.expired', field: 'code' });
    await expect(confirmEmailCode(userId, { code: '12ab56' })).rejects.toMatchObject({ code: 'verify.code_format' });
  });

  it('asks the member to wait while the code is still being sent', async () => {
    const userId = await member();
    await startEmailVerification(userId, { email: 'ada@uni.edu' });
    await expect(confirmEmailCode(userId, { code: '123456' })).rejects.toMatchObject({ code: 'verify.not_sent' });
  });
});
