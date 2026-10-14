import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { setMailTransport } from '@commitmates/email';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getHealth } from '../admin/service';
import { registerAllHandlers } from '../handlers';

import { EmailQuotaError, deliverEmail, nextUtcMidnight, utcDay } from './email';

const NOW = new Date('2026-10-14T22:30:00Z');
const sendMail = vi.fn((message: { to: string; subject: string }) => Promise.resolve({ messageId: `<${message.to}>` }));
let database: TestDatabase;

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
  sendMail.mockClear();
  await database.sql`truncate email_daily_counts, jobs`;
});

const notice = { notice: 'restored' } as const;

describe('day boundaries', () => {
  it('counts sends per UTC day and resets at the next UTC midnight', () => {
    expect(utcDay(NOW)).toBe('2026-10-14');
    expect(nextUtcMidnight(NOW).toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(nextUtcMidnight(new Date('2026-10-15T00:00:00Z')).toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });
});

describe('deliverEmail', () => {
  it('sends up to email.maxPerDay, then defers until the next day', async () => {
    await withSettings({ 'email.maxPerDay': 2 }, async () => {
      await deliverEmail('accountNotice', notice, 'a@uni.edu', NOW);
      await deliverEmail('accountNotice', notice, 'b@uni.edu', NOW);
      const error = await deliverEmail('accountNotice', notice, 'c@uni.edu', NOW).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(EmailQuotaError);
      expect((error as EmailQuotaError).resetAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect((error as EmailQuotaError).userMessage).toContain('as many emails as we can today');
      expect(sendMail).toHaveBeenCalledTimes(2);
      // A new day has a new allowance.
      await deliverEmail('accountNotice', notice, 'c@uni.edu', new Date('2026-10-15T00:00:01Z'));
      expect(sendMail).toHaveBeenCalledTimes(3);
    });
  });

  it('never exceeds the cap when many sends race', async () => {
    await withSettings({ 'email.maxPerDay': 3 }, async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) => deliverEmail('accountNotice', notice, `${index}@uni.edu`, NOW)),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
      expect(sendMail).toHaveBeenCalledTimes(3);
      expect(await database.sql`select sent from email_daily_counts where day = '2026-10-14'`).toEqual([{ sent: 3 }]);
    });
  });

  it('sends nothing at a cap of zero', async () => {
    await withSettings({ 'email.maxPerDay': 0 }, async () => {
      await expect(deliverEmail('accountNotice', notice, 'a@uni.edu', NOW)).rejects.toBeInstanceOf(EmailQuotaError);
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});

describe('send_email job', () => {
  it("sends to the member's sign-in address, and waits for tomorrow beyond the cap without using an attempt", async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`update auth.users set email = 'ada@uni.edu' where id = ${userId}`;
    await withSettings({ 'email.maxPerDay': 1 }, async () => {
      const payload = { userId, template: 'digest', data: { items: [{ title: 'Streak', line: 'Day 7.' }], settingsPath: '/settings' } };
      const first = await enqueue('send_email', payload, { idempotencyKey: 'digest:1' });
      await runTick({ budgetMs: 30_000, onlyJobId: first.id });
      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@uni.edu', subject: '1 update on CommitMates' }));

      const second = await enqueue('send_email', payload, { idempotencyKey: 'digest:2' });
      await runTick({ budgetMs: 30_000, onlyJobId: second.id });
      const [row] = await database.sql<{ status: string; attempts: number; run_at: Date }[]>`
        select status, attempts, run_at from jobs where id = ${second.id}`;
      expect(row).toMatchObject({ status: 'queued', attempts: 0 });
      expect(row!.run_at.getTime()).toBeGreaterThan(Date.now());
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses payloads that are not a known, secret-free template', async () => {
    const userId = await insertTestUser(database.sql);
    const job = await enqueue('send_email', { userId, template: 'verificationCode', data: { code: '123456', minutes: 10, universityName: null } });
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    const [row] = await database.sql`select status from jobs where id = ${job.id}`;
    expect(row?.status).toBe('dead');
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('admin health', () => {
  it("shows today's sends against the cap and alerts above the alert share", async () => {
    await withSettings({ 'email.maxPerDay': 10 }, async () => {
      await database.sql`insert into email_daily_counts (day, sent) values (${utcDay(new Date())}, 10)`;
      const health = await getHealth();
      expect(health.email).toEqual({ sentToday: 10, cap: 10 });
      expect(health.alerts).toContainEqual({ key: 'email_quota', values: { sent: 10, cap: 10 } });
    });
  });
});
