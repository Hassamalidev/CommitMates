import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { verifyOtp } from '../otp';
import { emailVerifications, notifications, profiles, universities, users, vouches } from '../schema';

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

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

/**
 * Records the university an unverified member says they attend, for the vouching path
 * (§8 F10 step 5). Verified members change university by email instead. Returns false when the
 * member is already verified.
 */
export async function claimUniversity(userId: string, universityId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(profiles)
    .set({ universityId })
    .where(and(eq(profiles.userId, userId), isNull(profiles.verifiedAt)))
    .returning({ userId: profiles.userId });
  return rows.length > 0;
}

export type VouchProgress = { universityId: string; universityName: string; vouches: number };

/** An unverified member's chosen university and how many members have vouched for them there. */
export async function getVouchProgress(userId: string, db: DbOrTx = getDb()): Promise<VouchProgress | null> {
  const [claim] = await db
    .select({ universityId: profiles.universityId, universityName: universities.name })
    .from(profiles)
    .innerJoin(universities, eq(universities.id, profiles.universityId))
    .where(and(eq(profiles.userId, userId), isNull(profiles.verifiedAt)));
  if (!claim?.universityId) return null;
  const [row] = await db
    .select({ vouches: count() })
    .from(vouches)
    .where(and(eq(vouches.voucheeUserId, userId), eq(vouches.universityId, claim.universityId)));
  return { universityId: claim.universityId, universityName: claim.universityName, vouches: row?.vouches ?? 0 };
}

export type VouchOutcome =
  | { status: 'no_claim' }
  | { status: 'voucher_not_eligible' }
  | { status: 'already_vouched' }
  | { status: 'vouched'; vouches: number; verified: boolean };

/**
 * One member vouches for another (§8 F10 step 5), in a transaction that locks the vouchee's
 * profile so two last vouches cannot both verify. The voucher must be an active member verified
 * at the vouchee's chosen university for at least `voucherMinDays`. At `required` vouches the
 * vouchee is verified (`verified_via = 'vouch'`), counted as a member and notified.
 */
export async function vouchFor(
  voucherId: string,
  voucheeId: string,
  now: Date,
  rules: { required: number; voucherMinDays: number },
  db: DbOrTx = getDb(),
): Promise<VouchOutcome> {
  return db.transaction(async (tx): Promise<VouchOutcome> => {
    const [vouchee] = await tx
      .select({ universityId: profiles.universityId, verifiedAt: profiles.verifiedAt })
      .from(profiles)
      .where(eq(profiles.userId, voucheeId))
      .for('update');
    if (!vouchee?.universityId || vouchee.verifiedAt !== null || voucherId === voucheeId) return { status: 'no_claim' };

    const [voucher] = await tx
      .select({ universityId: profiles.universityId, verifiedAt: profiles.verifiedAt, status: users.status })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, voucherId));
    const cutoff = now.getTime() - rules.voucherMinDays * MS_PER_DAY;
    if (voucher?.status !== 'active' || voucher.universityId !== vouchee.universityId || voucher.verifiedAt === null || voucher.verifiedAt.getTime() > cutoff) {
      return { status: 'voucher_not_eligible' };
    }

    const inserted = await tx
      .insert(vouches)
      .values({ voucherUserId: voucherId, voucheeUserId: voucheeId, universityId: vouchee.universityId })
      .onConflictDoNothing()
      .returning({ id: vouches.id });
    if (inserted.length === 0) return { status: 'already_vouched' };

    const [row] = await tx
      .select({ vouches: count() })
      .from(vouches)
      .where(and(eq(vouches.voucheeUserId, voucheeId), eq(vouches.universityId, vouchee.universityId)));
    const total = row?.vouches ?? 0;
    if (total < rules.required) return { status: 'vouched', vouches: total, verified: false };

    await tx.update(profiles).set({ verifiedAt: now, verifiedVia: 'vouch' }).where(eq(profiles.userId, voucheeId));
    await tx
      .update(universities)
      .set({ memberCount: sql`${universities.memberCount} + 1` })
      .where(eq(universities.id, vouchee.universityId));
    await tx.insert(notifications).values({ userId: voucheeId, kind: 'verified_by_vouches', data: { universityId: vouchee.universityId } });
    return { status: 'vouched', vouches: total, verified: true };
  });
}

/** Whether this member already vouched for that one, to hide the button. */
export async function hasVouched(voucherId: string, voucheeId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: vouches.id })
    .from(vouches)
    .where(and(eq(vouches.voucherUserId, voucherId), eq(vouches.voucheeUserId, voucheeId)));
  return row !== undefined;
}

/** Where and since when a member is verified, and whether their account is active. */
export async function getVerificationState(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select({ universityId: profiles.universityId, verifiedAt: profiles.verifiedAt, status: users.status })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId));
  return row ?? null;
}
