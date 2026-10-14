import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { matchSuggestions, profiles, skillVectors } from '../schema';

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

/** Universities with at least `minMembers` verified members: where matching is unlocked (§1.4). */
export async function universitiesWithMembers(minMembers: number, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.execute<{ university_id: string }>(sql`
    select university_id from profiles
    where verified_at is not null and university_id is not null
    group by university_id having count(*) >= ${minMembers}`);
  return rows.map((row) => row.university_id);
}

export type PoolMember = {
  userId: string;
  vector: Record<string, number>;
  topTags: string[];
  interests: string[];
  learningGoals: string[];
  /** Ghost mode or a hidden profile: the member may be served, but is never shown to others. */
  invisible: boolean;
};

/** Verified, active members of a university who have a skill vector (§8 F11). */
export async function matchPool(universityId: string, db: DbOrTx = getDb()): Promise<PoolMember[]> {
  const rows = await db.execute<{
    user_id: string;
    vector: Record<string, number>;
    top_tags: string[];
    interests: string[];
    learning_goals: string[];
    invisible: boolean;
  }>(sql`
    select v.user_id, v.vector, v.top_tags, v.interests, p.learning_goals,
           (p.ghost_mode or p.visibility = 'hidden') as invisible
    from skill_vectors v
    join profiles p on p.user_id = v.user_id
    join users u on u.id = v.user_id
    where p.university_id = ${universityId} and p.verified_at is not null and u.status = 'active'
    order by v.user_id`);
  return rows.map((row) => ({
    userId: row.user_id,
    vector: row.vector,
    topTags: row.top_tags,
    interests: row.interests,
    learningGoals: row.learning_goals,
    invisible: row.invisible,
  }));
}

/** `a|b` keys of pairs that must never be suggested: a block either way, or an existing connection. */
export async function excludedPairs(universityId: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const rows = await db.execute<{ a: string; b: string }>(sql`
    select b.blocker as a, b.blocked as b from blocks b
    join profiles p on p.user_id = b.blocker where p.university_id = ${universityId}
    union
    select c.user_a, c.user_b from connections c
    join profiles p on p.user_id = c.user_a where p.university_id = ${universityId}`);
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(`${row.a}|${row.b}`);
    keys.add(`${row.b}|${row.a}`);
  }
  return keys;
}

export type NewSuggestion = {
  userId: string;
  candidateUserId: string;
  mode: 'study' | 'teammate' | 'explore';
  score: number;
  components: unknown;
  explanationKeys: unknown;
  shownOn: string;
};

/** Stores a day's decks; a rerun on the same day keeps what was already shown. */
export async function saveSuggestions(rows: readonly NewSuggestion[], db: DbOrTx = getDb()): Promise<number> {
  let inserted = 0;
  const BATCH = 500; // allowed-literal: rows per statement, well under the parameter limit
  for (let start = 0; start < rows.length; start += BATCH) {
    const result = await db
      .insert(matchSuggestions)
      .values(rows.slice(start, start + BATCH).map((row) => ({ ...row })))
      .onConflictDoNothing()
      .returning({ id: matchSuggestions.id });
    inserted += result.length;
  }
  return inserted;
}
