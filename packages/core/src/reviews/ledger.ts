import {
  ForbiddenError,
  ValidationError,
  appendLedgerEntry,
  getDb,
  getSetting,
  hasLedgerEntry,
  ledgerBalance,
  ledgerHistory,
  lockLedger,
  requestSettled,
  writeAudit,
  type LedgerEntry,
  type Tx,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';
import { hasRole } from '../profiles/service';

/** Credits one review costs its author and earns its reviewer (CLAUDE.md §8 F15 "Credits"). */
export const REVIEW_COST = 1;
/** Ledger rows shown with the balance. */
export const LEDGER_HISTORY_SIZE = 20;

/** Locks every member's ledger in one fixed order, so two transactions never wait on each other in a cycle. */
async function lockAll(userIds: readonly string[], tx: Tx): Promise<void> {
  for (const userId of [...new Set(userIds)].sort()) await lockLedger(userId, tx);
}

/**
 * The starter credits a member receives once, on verification (§8 F15 "Credits"). Re-verifying, for
 * example at another university, grants nothing more. Returns the credits granted.
 */
export async function grantStarterCredits(userId: string): Promise<number> {
  const amount = await getSetting('reviews.starterCredits');
  if (amount <= 0) return 0;
  return getDb().transaction(async (tx) => {
    await lockLedger(userId, tx);
    if (await hasLedgerEntry(userId, 'starter', null, tx)) return 0;
    await appendLedgerEntry({ userId, delta: amount, reason: 'starter', requestId: null }, tx);
    return amount;
  });
}

/**
 * Holds one credit from a review request's author (§8 F15 "Request" step 3), inside the caller's
 * transaction so the request and its escrow land together. The balance is checked under the lock.
 */
export async function escrowCredit(tx: Tx, authorId: string, requestId: string): Promise<void> {
  await lockLedger(authorId, tx);
  if ((await ledgerBalance(authorId, tx)) < REVIEW_COST) {
    throw new ValidationError('reviews.no_credit', "Review someone else's code to earn a credit.");
  }
  await appendLedgerEntry({ userId: authorId, delta: -REVIEW_COST, reason: 'escrow', requestId }, tx);
}

/** Whether a request's escrow is still held: taken from its author and neither released nor refunded. */
async function escrowHeld(tx: Tx, authorId: string, requestId: string): Promise<boolean> {
  return (await hasLedgerEntry(authorId, 'escrow', requestId, tx)) && !(await requestSettled(requestId, tx));
}

/**
 * Settles a held escrow (§8 F15 "Rating and settlement"): released to the reviewer for a helpful
 * review, or refunded to the author. Each request settles once; a second call does nothing and
 * returns false. Runs inside the caller's transaction with both ledgers locked.
 */
export async function settleEscrow(
  tx: Tx,
  input: { authorId: string; requestId: string } & ({ outcome: 'release'; reviewerId: string } | { outcome: 'refund' }),
): Promise<boolean> {
  await lockAll(input.outcome === 'release' ? [input.authorId, input.reviewerId] : [input.authorId], tx);
  if (!(await escrowHeld(tx, input.authorId, input.requestId))) return false;
  if (input.outcome === 'release') {
    await appendLedgerEntry({ userId: input.reviewerId, delta: REVIEW_COST, reason: 'release', requestId: input.requestId }, tx);
  } else {
    await appendLedgerEntry({ userId: input.authorId, delta: REVIEW_COST, reason: 'refund', requestId: input.requestId }, tx);
  }
  return true;
}

export type CreditOverview = { balance: number; history: LedgerEntry[] };

/** A member's balance and recent ledger rows. */
export async function getCredits(userId: string): Promise<CreditOverview> {
  const [balance, history] = await Promise.all([ledgerBalance(userId), ledgerHistory(userId, LEDGER_HISTORY_SIZE)]);
  return { balance, history };
}

export const adjustCreditsSchema = z.object({
  userId: z.uuid(),
  delta: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, 'Enter a number of credits other than 0.'),
  note: z.string().trim().min(1, 'Say why, for the audit log.'),
});

/**
 * An admin's correction, e.g. after a dispute (§5.10 "Credit-ledger manipulation"): one appended
 * `admin_adjust` row, audited, and never below a zero balance.
 */
export async function adjustCredits(actor: Pick<Member, 'id' | 'roles'>, raw: unknown): Promise<number> {
  if (!hasRole(actor, 'admin')) throw new ForbiddenError('reviews.adjust_forbidden', 'Only admins can adjust credits.');
  const input = adjustCreditsSchema.parse(raw);
  return getDb().transaction(async (tx) => {
    await lockLedger(input.userId, tx);
    const balance = await ledgerBalance(input.userId, tx);
    if (balance + input.delta < 0) {
      throw new ValidationError('reviews.adjust_negative', `That would leave ${balance + input.delta} credits; the balance cannot go below 0.`, { field: 'delta' });
    }
    const id = await appendLedgerEntry({ userId: input.userId, delta: input.delta, reason: 'admin_adjust', requestId: null }, tx);
    await writeAudit(
      { actorUserId: actor.id, action: 'credits.adjusted', targetType: 'user', targetId: input.userId, data: { delta: input.delta, note: input.note, ledgerId: id } },
      tx,
    );
    return balance + input.delta;
  });
}
