import { eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { emailDailyCounts } from '../schema';

/**
 * Takes one send from the day's allowance, atomically: the counter only moves while it is
 * below `cap`, so concurrent senders can never exceed it. Returns false when the day is full.
 */
export async function reserveEmailSlot(day: string, cap: number, db: DbOrTx = getDb()): Promise<boolean> {
  if (cap <= 0) return false;
  const rows = await db
    .insert(emailDailyCounts)
    .values({ day, sent: 1 })
    .onConflictDoUpdate({
      target: emailDailyCounts.day,
      set: { sent: sql`${emailDailyCounts.sent} + 1` },
      setWhere: sql`${emailDailyCounts.sent} < ${cap}`,
    })
    .returning({ sent: emailDailyCounts.sent });
  return rows.length > 0;
}

/** Emails sent on a UTC day (`YYYY-MM-DD`). */
export async function emailsSentOn(day: string, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db.select({ sent: emailDailyCounts.sent }).from(emailDailyCounts).where(eq(emailDailyCounts.day, day));
  return row?.sent ?? 0;
}

/** A member's sign-in email, from Supabase Auth. Read at send time; never copied elsewhere. */
export async function authEmailOf(userId: string, db: DbOrTx = getDb()): Promise<string | null> {
  const rows = await db.execute<{ email: string | null }>(sql`select email from auth.users where id = ${userId}`);
  return rows[0]?.email ?? null;
}
