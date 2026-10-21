import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { swapOffers, swapProposals, swapResponses, swapWants } from '../schema';

export type OfferRow = { userId: string; tag: string; level: number; verified: boolean };
export type WantRow = { userId: string; tag: string; priority: number };

/** `a|b` keys, both ways, of pairs at a university where one blocked the other. */
export async function blockedPairsAt(universityId: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const rows = await db.execute<{ a: string; b: string }>(sql`
    select b.blocker as a, b.blocked as b from blocks b
    join profiles p on p.user_id = b.blocker
    where p.university_id = ${universityId}`);
  const pairs = new Set<string>();
  for (const row of rows) {
    pairs.add(`${row.a}|${row.b}`);
    pairs.add(`${row.b}|${row.a}`);
  }
  return pairs;
}

/** Offers of the given members, verified and self-declared. */
export async function offersOf(userIds: readonly string[], db: DbOrTx = getDb()): Promise<OfferRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: swapOffers.userId, tag: swapOffers.tag, level: swapOffers.level, verified: swapOffers.verified })
    .from(swapOffers)
    .where(inArray(swapOffers.userId, [...userIds]))
    .orderBy(swapOffers.userId, swapOffers.tag);
}

/** Wants the given members added on the Skill Swap page. */
export async function wantsOf(userIds: readonly string[], db: DbOrTx = getDb()): Promise<WantRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ userId: swapWants.userId, tag: swapWants.tag, priority: swapWants.priority })
    .from(swapWants)
    .where(inArray(swapWants.userId, [...userIds]))
    .orderBy(swapWants.userId, swapWants.tag);
}

/**
 * Replaces the verified offers of these members with the ones their code supports now (§8 F16
 * "Offers and wants"). A self-declared offer of a tag that is now verified becomes verified.
 */
export async function replaceVerifiedOffers(userIds: readonly string[], offers: readonly { userId: string; tag: string; level: number }[], tx: Tx): Promise<void> {
  if (userIds.length === 0) return;
  await tx.delete(swapOffers).where(and(inArray(swapOffers.userId, [...userIds]), eq(swapOffers.verified, true)));
  if (offers.length === 0) return;
  await tx
    .insert(swapOffers)
    .values(offers.map((offer) => ({ ...offer, verified: true })))
    .onConflictDoUpdate({ target: [swapOffers.userId, swapOffers.tag], set: { verified: true, level: sql`excluded.level` } });
}

/** Replaces a member's self-declared offers; tags they already have verified stay verified. */
export async function replaceSelfDeclaredOffers(userId: string, tags: readonly string[], level: number, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(swapOffers).where(and(eq(swapOffers.userId, userId), eq(swapOffers.verified, false)));
    if (tags.length > 0) {
      await tx
        .insert(swapOffers)
        .values(tags.map((tag) => ({ userId, tag, level, verified: false })))
        .onConflictDoNothing();
    }
  });
}

/** Replaces a member's wants. */
export async function replaceWants(userId: string, wants: readonly { tag: string; priority: number }[], db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(swapWants).where(eq(swapWants.userId, userId));
    if (wants.length > 0) await tx.insert(swapWants).values(wants.map((want) => ({ userId, ...want })));
  });
}

/** Marks proposals past their deadline expired; returns their ids. */
export async function expireSwapProposals(universityId: string, now: Date, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db
    .update(swapProposals)
    .set({ status: 'expired' })
    .where(and(eq(swapProposals.universityId, universityId), eq(swapProposals.status, 'proposed'), sql`${swapProposals.expiresAt} <= ${now.toISOString()}::timestamptz`))
    .returning({ id: swapProposals.id });
  return rows.map((row) => row.id);
}

/** Members already in a proposal that is still waiting for answers (§8 F16 step 2). */
export async function membersInOpenProposals(universityId: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const rows = await db.execute<{ member: string }>(sql`
    select distinct unnest(members) as member from swap_proposals where university_id = ${universityId} and status = 'proposed'`);
  return new Set(rows.map((row) => row.member));
}

export async function insertSwapProposal(
  proposal: { universityId: string; members: string[]; edges: { from: string; to: string; tag: string }[]; quality: number; expiresAt: Date },
  tx: DbOrTx,
): Promise<string> {
  const [row] = await tx.insert(swapProposals).values(proposal).returning({ id: swapProposals.id });
  if (!row) throw new Error('swap proposal insert returned no row');
  return row.id;
}

export type SwapProposalRow = {
  id: string;
  universityId: string;
  members: string[];
  edges: { from: string; to: string; tag: string }[];
  quality: number;
  status: 'proposed' | 'accepted' | 'declined' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  responses: { userId: string; response: 'accept' | 'decline' }[];
};

/** A member's proposals, newest first, with every member's answer so far. */
export async function proposalsFor(userId: string, limit: number, db: DbOrTx = getDb()): Promise<SwapProposalRow[]> {
  const rows = await db
    .select()
    .from(swapProposals)
    .where(sql`${swapProposals.members} @> array[${userId}]::uuid[]`)
    .orderBy(sql`${swapProposals.createdAt} desc`)
    .limit(limit);
  if (rows.length === 0) return [];
  const answers = await db
    .select({ proposalId: swapResponses.proposalId, userId: swapResponses.userId, response: swapResponses.response })
    .from(swapResponses)
    .where(inArray(swapResponses.proposalId, rows.map((row) => row.id)));
  return rows.map((row) => ({
    id: row.id,
    universityId: row.universityId,
    members: row.members,
    edges: row.edges,
    quality: row.quality,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    responses: answers.filter((answer) => answer.proposalId === row.id).map((answer) => ({ userId: answer.userId, response: answer.response })),
  }));
}

/** Locks a proposal for an answer. */
export async function lockSwapProposal(proposalId: string, tx: Tx): Promise<Omit<SwapProposalRow, 'responses'> | null> {
  const [row] = await tx.select().from(swapProposals).where(eq(swapProposals.id, proposalId)).for('update');
  return row ?? null;
}

/** Records (or changes) a member's answer; the members who have accepted so far. */
export async function recordSwapResponse(proposalId: string, userId: string, response: 'accept' | 'decline', now: Date, tx: Tx): Promise<string[]> {
  await tx
    .insert(swapResponses)
    .values({ proposalId, userId, response, respondedAt: now })
    .onConflictDoUpdate({ target: [swapResponses.proposalId, swapResponses.userId], set: { response, respondedAt: now } });
  const rows = await tx
    .select({ userId: swapResponses.userId })
    .from(swapResponses)
    .where(and(eq(swapResponses.proposalId, proposalId), eq(swapResponses.response, 'accept')));
  return rows.map((row) => row.userId);
}

export async function setSwapProposalStatus(proposalId: string, status: 'accepted' | 'declined' | 'expired', tx: DbOrTx): Promise<void> {
  await tx.update(swapProposals).set({ status }).where(eq(swapProposals.id, proposalId));
}
