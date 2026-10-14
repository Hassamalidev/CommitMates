import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { profiles, skillVectors } from '../schema';

/** Saves a member's base term frequencies and interests; the weighted vector follows separately. */
export async function upsertSkillBase(
  userId: string,
  base: Record<string, number>,
  interests: readonly string[],
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db
    .insert(skillVectors)
    .values({ userId, base, vector: {}, topTags: [], interests: [...interests], computedAt: now })
    .onConflictDoUpdate({ target: skillVectors.userId, set: { base, interests: [...interests], computedAt: now } });
}

/** Base vectors of every verified member of a university, for TF-IDF (CLAUDE.md §8 F11 step 2). */
export async function universityBases(universityId: string, db: DbOrTx = getDb()): Promise<Map<string, Record<string, number>>> {
  const rows = await db
    .select({ userId: skillVectors.userId, base: skillVectors.base })
    .from(skillVectors)
    .innerJoin(profiles, eq(profiles.userId, skillVectors.userId))
    .where(and(eq(profiles.universityId, universityId), isNotNull(profiles.verifiedAt)));
  return new Map(rows.map((row) => [row.userId, row.base]));
}

/** Writes the weighted vectors and top tags computed for a university, in one transaction. */
export async function saveWeightedVectors(
  rows: readonly { userId: string; vector: Record<string, number>; topTags: string[] }[],
  db: DbOrTx = getDb(),
): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.update(skillVectors).set({ vector: row.vector, topTags: row.topTags }).where(eq(skillVectors.userId, row.userId));
    }
  });
}

/** A member's stored skill vector, if computed. */
export async function getSkillVector(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(skillVectors).where(eq(skillVectors.userId, userId));
  return row ?? null;
}

/** Verified members whose vector is missing or older than `before`, for the weekly refresh. */
export async function membersWithStaleVectors(before: Date, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select p.user_id from profiles p
    left join skill_vectors v on v.user_id = p.user_id
    where p.verified_at is not null and (v.computed_at is null or v.computed_at < ${before.toISOString()}::timestamptz)`);
  return rows.map((row) => row.user_id);
}
