import { and, desc, eq, gte, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { pairCompanions, pairDays, pairs } from '../schema';

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
