import { and, count, desc, eq, gte, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { githubIdentities, pairCompanions, pairDays, pairInvites, pairs } from '../schema';

export type PairRow = typeof pairs.$inferSelect;

/** Active pairs with what the judgement needs about each member, oldest first. */
export async function activePairs(db: DbOrTx = getDb()): Promise<
  { id: string; userA: string; userB: string; lastJudgedDay: string | null; createdAt: Date; timezoneA: string; timezoneB: string }[]
> {
  const rows = await db.execute<{
    id: string;
    user_a: string;
    user_b: string;
    last_judged_day: string | null;
    created_at: string;
    tz_a: string;
    tz_b: string;
  }>(sql`
    select p.id, p.user_a, p.user_b, p.last_judged_day::text as last_judged_day, p.created_at, pa.timezone as tz_a, pb.timezone as tz_b
    from pairs p
    join profiles pa on pa.user_id = p.user_a
    join profiles pb on pb.user_id = p.user_b
    where p.status = 'active'
    order by p.created_at, p.id`);
  return rows.map((row) => ({
    id: row.id,
    userA: row.user_a,
    userB: row.user_b,
    lastJudgedDay: row.last_judged_day,
    createdAt: new Date(row.created_at),
    timezoneA: row.tz_a,
    timezoneB: row.tz_b,
  }));
}

/** A pair, locked for the rest of the transaction. */
export async function lockPair(pairId: string, tx: DbOrTx): Promise<PairRow | null> {
  const [row] = await tx.select().from(pairs).where(eq(pairs.id, pairId)).for('update');
  return row ?? null;
}

export type PairStateUpdate = {
  currentStreak: number;
  longestStreak: number;
  freezesAvailable: number;
  missedInRow: number;
  lastJudgedDay: string;
  status?: 'active' | 'paused';
};

export async function updatePairState(pairId: string, update: PairStateUpdate, db: DbOrTx = getDb()): Promise<void> {
  await db.update(pairs).set(update).where(eq(pairs.id, pairId));
}

/** Records one judged day; judging the same day again keeps the first record. */
export async function insertPairDay(
  day: { pairId: string; day: string; aCount: number; bCount: number; outcome: 'counted' | 'frozen' | 'missed' },
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.insert(pairDays).values(day).onConflictDoNothing();
}

/** Sets the pair companion's stage and mood, creating it with its seed the first time. */
export async function upsertPairCompanion(
  pairId: string,
  seed: number,
  stage: number,
  mood: 'happy' | 'neutral' | 'sad',
  db: DbOrTx = getDb(),
): Promise<void> {
  await db
    .insert(pairCompanions)
    .values({ pairId, seed, stage, mood })
    .onConflictDoUpdate({ target: pairCompanions.pairId, set: { stage, mood } });
}

/** A pair's days since `since`, newest first. */
export async function listPairDays(pairId: string, since: string, db: DbOrTx = getDb()) {
  return db
    .select({ day: pairDays.day, aCount: pairDays.aCount, bCount: pairDays.bCount, outcome: pairDays.outcome })
    .from(pairDays)
    .where(and(eq(pairDays.pairId, pairId), gte(pairDays.day, since)))
    .orderBy(desc(pairDays.day));
}

/** Pairs a member is in that have not ended, newest first. */
export async function listMemberPairs(userId: string, db: DbOrTx = getDb()): Promise<PairRow[]> {
  return db
    .select()
    .from(pairs)
    .where(and(or(eq(pairs.userA, userId), eq(pairs.userB, userId)), sql`${pairs.status} <> 'ended'`))
    .orderBy(desc(pairs.createdAt));
}

export async function getPairCompanion(pairId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(pairCompanions).where(eq(pairCompanions.pairId, pairId));
  return row ?? null;
}

/** The pair two members have that has not ended, if any. */
export async function openPairBetween(a: string, b: string, db: DbOrTx = getDb()): Promise<PairRow | null> {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select()
    .from(pairs)
    .where(and(eq(pairs.userA, userA), eq(pairs.userB, userB), sql`${pairs.status} <> 'ended'`));
  return row ?? null;
}

/** Active pairs a member is in, for `streaks.maxActivePairs`. */
export async function countActivePairs(userId: string, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(pairs)
    .where(and(or(eq(pairs.userA, userId), eq(pairs.userB, userId)), eq(pairs.status, 'active')));
  return row?.value ?? 0;
}

export type PairInviteRow = typeof pairInvites.$inferSelect;

/** A pending invite between two members in either direction. */
export async function pendingInviteBetween(a: string, b: string, db: DbOrTx = getDb()): Promise<PairInviteRow | null> {
  const [row] = await db
    .select()
    .from(pairInvites)
    .where(
      and(
        eq(pairInvites.status, 'pending'),
        or(and(eq(pairInvites.fromUser, a), eq(pairInvites.toUser, b)), and(eq(pairInvites.fromUser, b), eq(pairInvites.toUser, a))),
      ),
    );
  return row ?? null;
}

/** Stores a pending invite; null when one from this member to that one is already pending. */
export async function insertPairInvite(invite: { threadId: string; fromUser: string; toUser: string }, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.insert(pairInvites).values(invite).onConflictDoNothing().returning({ id: pairInvites.id });
  return row?.id ?? null;
}

/** An invite, locked for the rest of the transaction. */
export async function lockPairInvite(inviteId: string, tx: DbOrTx): Promise<PairInviteRow | null> {
  const [row] = await tx.select().from(pairInvites).where(eq(pairInvites.id, inviteId)).for('update');
  return row ?? null;
}

export async function setPairInviteStatus(inviteId: string, status: 'accepted' | 'declined' | 'cancelled', now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.update(pairInvites).set({ status, respondedAt: now }).where(eq(pairInvites.id, inviteId));
}

/** Creates an active pair with its companion; the two member ids are stored in order. */
export async function createPair(pairId: string, a: string, b: string, seed: number, db: DbOrTx = getDb()): Promise<void> {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  await db.insert(pairs).values({ id: pairId, userA, userB });
  await db.insert(pairCompanions).values({ pairId, seed, stage: 0, mood: 'neutral' });
}

/** Ends a pair. */
export async function endPairRow(pairId: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.update(pairs).set({ status: 'ended', endedAt: now }).where(eq(pairs.id, pairId));
}

/** Resumes a paused pair; days while it was paused are not judged. */
export async function resumePairRow(pairId: string, lastJudgedDay: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(pairs)
    .set({ status: 'active', missedInRow: 0, lastJudgedDay })
    .where(and(eq(pairs.id, pairId), eq(pairs.status, 'paused')))
    .returning({ id: pairs.id });
  return rows.length > 0;
}

export type InviteView = { id: string; threadId: string; login: string; name: string | null; createdAt: Date };

/** Pending invites to and from a member, newest first, with the other member's identity. */
export async function listPendingInvites(userId: string, db: DbOrTx = getDb()): Promise<{ incoming: InviteView[]; outgoing: InviteView[] }> {
  const rows = await db.execute<{ id: string; thread_id: string; from_user: string; login: string; name: string | null; created_at: string }>(sql`
    select i.id, i.thread_id, i.from_user, g.login, g.name, i.created_at
    from pair_invites i
    join github_identities g on g.user_id = case when i.from_user = ${userId} then i.to_user else i.from_user end
    where i.status = 'pending' and (i.from_user = ${userId} or i.to_user = ${userId})
    order by i.created_at desc`);
  const views = rows.map((row) => ({
    outgoing: row.from_user === userId,
    view: { id: row.id, threadId: row.thread_id, login: row.login, name: row.name, createdAt: new Date(row.created_at) },
  }));
  return {
    incoming: views.filter((entry) => !entry.outgoing).map((entry) => entry.view),
    outgoing: views.filter((entry) => entry.outgoing).map((entry) => entry.view),
  };
}

export type PairView = PairRow & {
  partner: { userId: string; login: string; name: string | null };
  companion: { seed: number; stage: number; mood: 'happy' | 'neutral' | 'sad' } | null;
};

/** A member's pairs that have not ended, newest first, with the partner and companion. */
export async function listPairViews(userId: string, db: DbOrTx = getDb()): Promise<PairView[]> {
  const rows = await listMemberPairs(userId, db);
  return Promise.all(
    rows.map(async (row) => {
      const partnerId = row.userA === userId ? row.userB : row.userA;
      const [[identity], companion] = await Promise.all([
        db
          .select({ login: githubIdentities.login, name: githubIdentities.name })
          .from(githubIdentities)
          .where(eq(githubIdentities.userId, partnerId)),
        getPairCompanion(row.id, db),
      ]);
      return {
        ...row,
        partner: { userId: partnerId, login: identity?.login ?? '', name: identity?.name ?? null },
        companion: companion ? { seed: companion.seed, stage: companion.stage, mood: companion.mood } : null,
      };
    }),
  );
}

/** Partners in pairs that have not ended, for notices when a member leaves. */
export async function openPairPartners(userId: string, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await listMemberPairs(userId, db);
  return rows.map((row) => (row.userA === userId ? row.userB : row.userA));
}

export async function getPairById(pairId: string, db: DbOrTx = getDb()): Promise<PairRow | null> {
  const [row] = await db.select().from(pairs).where(eq(pairs.id, pairId));
  return row ?? null;
}
