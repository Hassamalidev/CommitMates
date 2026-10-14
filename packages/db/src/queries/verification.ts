import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { verifyOtp } from '../otp';
import { emailVerifications, profiles, universities } from '../schema';

/** Length of `YYYY-MM-DD`, the date part of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;
const utcDay = (date: Date) => date.toISOString().slice(0, ISO_DATE_LENGTH);

export type PendingVerification = {
  id: string;
  email: string | null;
  domain: string;
  universityId: string | null;
  universityName: string | null;
  codeSent: boolean;
  expiresAt: Date | null;
  attempts: number;
};

/** The member's open verification, if any, with the university it is for. */
export async function getPendingVerification(userId: string, db: DbOrTx = getDb()): Promise<PendingVerification | null> {
  const [row] = await db
    .select({
      id: emailVerifications.id,
      email: emailVerifications.email,
      domain: emailVerifications.domain,
      universityId: emailVerifications.universityId,
      universityName: universities.name,
      codeHash: emailVerifications.codeHash,
      expiresAt: emailVerifications.expiresAt,
      attempts: emailVerifications.attempts,
    })
    .from(emailVerifications)
    .leftJoin(universities, eq(universities.id, emailVerifications.universityId))
    .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.verifiedAt)));
  if (!row) return null;
  const { codeHash, ...rest } = row;
  return { ...rest, codeSent: codeHash !== null };
}

export type StartVerificationInput = { userId: string; email: string; domain: string; universityId: string };

/**
 * Opens (or restarts) the member's verification for an address and counts one send against
 * `maxSendsPerDay`. Sends are counted per UTC day. A restart clears the old code and attempts.
 */
export async function startPendingVerification(
  input: StartVerificationInput,
  now: Date,
  maxSendsPerDay: number,
  db: DbOrTx = getDb(),
): Promise<{ status: 'started'; id: string; sendNumber: number } | { status: 'send_limit' }> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: emailVerifications.id, sendsToday: emailVerifications.sendsToday, lastSentAt: emailVerifications.lastSentAt })
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, input.userId), isNull(emailVerifications.verifiedAt)))
      .for('update');
    const sentToday = pending?.lastSentAt && utcDay(pending.lastSentAt) === utcDay(now) ? pending.sendsToday : 0;
    if (sentToday >= maxSendsPerDay) return { status: 'send_limit' as const };

    const values = {
      email: input.email,
      domain: input.domain,
      universityId: input.universityId,
      codeHash: null,
      expiresAt: null,
      attempts: 0,
      sendsToday: sentToday + 1,
      lastSentAt: now,
    };
    if (pending) {
      await tx.update(emailVerifications).set(values).where(eq(emailVerifications.id, pending.id));
      return { status: 'started' as const, id: pending.id, sendNumber: values.sendsToday };
    }
    const [created] = await tx.insert(emailVerifications).values({ userId: input.userId, ...values }).returning({ id: emailVerifications.id });
    if (!created) throw new Error('email_verifications insert returned no row');
    return { status: 'started' as const, id: created.id, sendNumber: values.sendsToday };
  });
}

/** What `send_otp` needs to deliver a code; `null` once verified or replaced. */
export async function getVerificationForSending(
  id: string,
  db: DbOrTx = getDb(),
): Promise<{ email: string; universityName: string | null } | null> {
  const [row] = await db
    .select({ email: emailVerifications.email, universityName: universities.name, verifiedAt: emailVerifications.verifiedAt })
    .from(emailVerifications)
    .leftJoin(universities, eq(universities.id, emailVerifications.universityId))
    .where(eq(emailVerifications.id, id));
  if (row?.verifiedAt !== null || row.email === null) return null;
  return { email: row.email, universityName: row.universityName };
}

/** Stores a new code's hash and expiry; the previous code stops working. */
export async function storeVerificationCode(id: string, codeHash: string, expiresAt: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ codeHash, expiresAt, attempts: 0 })
    .where(and(eq(emailVerifications.id, id), isNull(emailVerifications.verifiedAt)));
}

export type CodeCheck =
  | { status: 'no_pending' }
  | { status: 'not_sent' }
  | { status: 'expired' }
  | { status: 'locked' }
  | { status: 'wrong'; remaining: number }
  | { status: 'verified'; universityId: string };

/**
 * Checks a submitted code (CLAUDE.md §8 F10 step 4). Every check counts as an attempt and is
 * committed whatever the outcome, so guesses cannot be retried for free. On success, in the
 * same transaction: the address is dropped (only the domain stays), the profile records the
 * university, and member counts move from any previous university to the new one.
 */
export async function checkVerificationCode(
  userId: string,
  code: string,
  now: Date,
  maxAttempts: number,
  db: DbOrTx = getDb(),
): Promise<CodeCheck> {
  return db.transaction(async (tx): Promise<CodeCheck> => {
    const [pending] = await tx
      .select()
      .from(emailVerifications)
      .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.verifiedAt)))
      .for('update');
    if (!pending) return { status: 'no_pending' };
    if (pending.codeHash === null || pending.expiresAt === null) return { status: 'not_sent' };
    if (pending.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
    if (pending.attempts >= maxAttempts) return { status: 'locked' };

    const attempts = pending.attempts + 1;
    if (!verifyOtp(code, pending.codeHash) || pending.universityId === null) {
      await tx.update(emailVerifications).set({ attempts }).where(eq(emailVerifications.id, pending.id));
      return attempts >= maxAttempts ? { status: 'locked' } : { status: 'wrong', remaining: maxAttempts - attempts };
    }

    await tx
      .update(emailVerifications)
      .set({ attempts, verifiedAt: now, email: null, codeHash: null })
      .where(eq(emailVerifications.id, pending.id));
    const [profile] = await tx
      .select({ universityId: profiles.universityId, verifiedAt: profiles.verifiedAt })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .for('update');
    const previous = profile?.verifiedAt ? profile.universityId : null;
    await tx
      .update(profiles)
      .set({ universityId: pending.universityId, verifiedAt: now, verifiedVia: 'email' })
      .where(eq(profiles.userId, userId));
    if (previous !== pending.universityId) {
      if (previous !== null) {
        await tx
          .update(universities)
          .set({ memberCount: sql`greatest(${universities.memberCount} - 1, 0)` })
          .where(eq(universities.id, previous));
      }
      await tx
        .update(universities)
        .set({ memberCount: sql`${universities.memberCount} + 1` })
        .where(eq(universities.id, pending.universityId));
    }
    return { status: 'verified', universityId: pending.universityId };
  });
}
