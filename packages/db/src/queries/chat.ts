import { and, count, eq, gte, min, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { blocks, messageRequests, profiles, trustScores, users } from '../schema';

export type ChatParticipant = {
  status: 'active' | 'suspended' | 'hidden_pending_review';
  universityId: string | null;
  verified: boolean;
  ghostMode: boolean;
  createdAt: Date;
};

/** What the request rules need to know about one side of a message request (CLAUDE.md §8 F12). */
export async function getChatParticipant(userId: string, db: DbOrTx = getDb()): Promise<ChatParticipant | null> {
  const [row] = await db
    .select({
      status: users.status,
      universityId: profiles.universityId,
      verifiedAt: profiles.verifiedAt,
      ghostMode: profiles.ghostMode,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;
  return { status: row.status, universityId: row.universityId, verified: row.verifiedAt !== null, ghostMode: row.ghostMode, createdAt: row.createdAt };
}

/**
 * Locks the sender's user row for the rest of the transaction, so two requests sent at once are
 * counted one after the other against the daily limit.
 */
export async function lockSender(userId: string, tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select id from users where id = ${userId} for update`);
}

/** Whether either member has blocked the other. */
export async function isBlockedEitherWay(a: string, b: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ blocker: blocks.blocker })
    .from(blocks)
    .where(or(and(eq(blocks.blocker, a), eq(blocks.blocked, b)), and(eq(blocks.blocker, b), eq(blocks.blocked, a))))
    .limit(1);
  return row !== undefined;
}

/** How many message requests a member has sent since `since`, whatever became of them, and when the first was sent. */
export async function requestsSentSince(userId: string, since: Date, db: DbOrTx = getDb()): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({ value: count(), oldest: min(messageRequests.createdAt) })
    .from(messageRequests)
    .where(and(eq(messageRequests.fromUser, userId), gte(messageRequests.createdAt, since)));
  return { count: row?.value ?? 0, oldest: row?.oldest ?? null };
}

/** The member's nightly trust multiplier, or null before their first trust score (§8 F12 "Trust score"). */
export async function getTrustMultiplier(userId: string, db: DbOrTx = getDb()): Promise<number | null> {
  const [row] = await db.select({ multiplier: trustScores.multiplier }).from(trustScores).where(eq(trustScores.userId, userId));
  return row?.multiplier ?? null;
}

export type NewMessageRequest = {
  fromUser: string;
  toUser: string;
  contextKind: string;
  contextId: string | null;
  icebreakerKey: string | null;
  firstMessage: string;
};

/** Stores a pending request; null when one is already pending from this sender to this person. */
export async function insertMessageRequest(request: NewMessageRequest, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.insert(messageRequests).values(request).onConflictDoNothing().returning({ id: messageRequests.id });
  return row?.id ?? null;
}
