import { and, desc, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { creditLedger, ledgerLocks } from '../schema';

export type LedgerReason = 'starter' | 'escrow' | 'release' | 'refund' | 'admin_adjust';

/**
 * Locks a member's ledger for the rest of the transaction (CLAUDE.md §8 F15 "Credits"): the lock row
 * is created on first use, then held `for update`, so two writes for one member check the balance in
 * turn and never both spend the same credit.
 */
export async function lockLedger(userId: string, tx: Tx): Promise<void> {
  await tx.insert(ledgerLocks).values({ userId }).onConflictDoNothing();
  await tx.select({ userId: ledgerLocks.userId }).from(ledgerLocks).where(eq(ledgerLocks.userId, userId)).for('update');
}

/** A member's balance: the sum of their ledger rows (the `credit_balances` view), 0 without any. */
export async function ledgerBalance(userId: string, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ balance: number }>(sql`select balance from credit_balances where user_id = ${userId}`);
  return rows[0]?.balance ?? 0;
}

/** Appends one row; the table accepts nothing else (§7.8 "append-only"). */
export async function appendLedgerEntry(
  entry: { userId: string; delta: number; reason: LedgerReason; requestId: string | null },
  tx: Tx,
): Promise<number> {
  const [row] = await tx.insert(creditLedger).values(entry).returning({ id: creditLedger.id });
  if (!row) throw new Error('ledger insert returned no row');
  return row.id;
}

/** Whether a member already has a row with this reason (for one-off grants) or for this request. */
export async function hasLedgerEntry(userId: string, reason: LedgerReason, requestId: string | null, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.reason, reason),
        requestId === null ? sql`${creditLedger.requestId} is null` : eq(creditLedger.requestId, requestId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Whether a request's escrow was already released or refunded (to anyone). */
export async function requestSettled(requestId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.requestId, requestId), sql`${creditLedger.reason} in ('release', 'refund')`))
    .limit(1);
  return row !== undefined;
}

export type LedgerEntry = { id: number; delta: number; reason: LedgerReason; requestId: string | null; createdAt: Date };

/** A member's most recent ledger rows, newest first. */
export async function ledgerHistory(userId: string, limit: number, db: DbOrTx = getDb()): Promise<LedgerEntry[]> {
  return db
    .select({ id: creditLedger.id, delta: creditLedger.delta, reason: creditLedger.reason, requestId: creditLedger.requestId, createdAt: creditLedger.createdAt })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit);
}
