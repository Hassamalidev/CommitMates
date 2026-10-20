import { and, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { matchSuggestions, personaSnapshots, profiles, skillVectors, type SnapshotCompanion } from '../schema';

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

export type DeckFilters = { departmentId?: string | undefined; yearFrom?: number | undefined; yearTo?: number | undefined; tag?: string | undefined };

export type DeckCardRow = {
  suggestionId: string;
  candidateUserId: string;
  mode: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  departmentId: string | null;
  department: string | null;
  gradYear: number | null;
  topTags: string[];
  score: number;
  explanation: unknown;
  /** From the candidate's latest persona snapshot; empty until their first one. */
  labels: string[];
  companion: SnapshotCompanion | null;
  /** 24 UTC hour shares, for the shared-hours line. */
  hourHistUtc: number[] | null;
};

const HOURS_PER_DAY = 24; // allowed-literal: hours in a day

const isHourHistogram = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === HOURS_PER_DAY && value.every((share) => typeof share === 'number');

type DeckSqlRow = {
  id: string;
  candidate_user_id: string;
  mode: string;
  // bigint: postgres.js returns it as a string.
  github_id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  department_id: string | null;
  department: string | null;
  grad_year: number | null;
  top_tags: string[] | null;
  score: number;
  explanation_keys: unknown;
  labels: string[] | null;
  companion: SnapshotCompanion | null;
  hour_hist_utc: unknown;
};

/**
 * Today's suggestions for a member matching `where`, best first, with what a card shows. Blocks
 * made after the deck was built, ghost mode or a hidden profile switched on since, and accounts
 * no longer active still hide a candidate.
 */
async function deckRows(userId: string, day: string, where: SQL, db: DbOrTx): Promise<DeckCardRow[]> {
  const rows = await db.execute<DeckSqlRow>(sql`
    select s.id, s.candidate_user_id, s.mode, g.github_id, g.login, g.name, g.avatar_url, p.department_id, d.name as department,
           p.grad_year, v.top_tags, s.score, s.explanation_keys, ps.labels, ps.companion,
           ps.metrics -> 'hourHistUtc' as hour_hist_utc
    from match_suggestions s
    join github_identities g on g.user_id = s.candidate_user_id
    join profiles p on p.user_id = s.candidate_user_id
    join users u on u.id = s.candidate_user_id
    left join departments d on d.id = p.department_id
    left join skill_vectors v on v.user_id = s.candidate_user_id
    left join persona_snapshots ps on ps.user_id = s.candidate_user_id
    where s.user_id = ${userId} and s.shown_on = ${day} and ${where}
      and u.status = 'active' and not p.ghost_mode and p.visibility <> 'hidden'
      and not exists (
        select 1 from blocks b
        where (b.blocker = ${userId} and b.blocked = s.candidate_user_id) or (b.blocker = s.candidate_user_id and b.blocked = ${userId}))
    order by s.score desc, s.id`);
  return rows.map((row) => ({
    suggestionId: row.id,
    candidateUserId: row.candidate_user_id,
    mode: row.mode,
    githubId: Number(row.github_id),
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
    departmentId: row.department_id,
    department: row.department,
    gradYear: row.grad_year,
    topTags: row.top_tags ?? [],
    score: row.score,
    explanation: row.explanation_keys,
    labels: row.labels ?? [],
    companion: row.companion,
    hourHistUtc: isHourHistogram(row.hour_hist_utc) ? row.hour_hist_utc : null,
  }));
}

/** Today's unanswered suggestions for one mode, narrowed by the Discover filters (§8 F11 "UI"). */
export function listDeck(userId: string, day: string, mode: string, filters: DeckFilters, db: DbOrTx = getDb()): Promise<DeckCardRow[]> {
  return deckRows(
    userId,
    day,
    sql`s.mode = ${mode} and s.action is null
      ${filters.departmentId ? sql`and p.department_id = ${filters.departmentId}` : sql``}
      ${filters.yearFrom === undefined ? sql`` : sql`and p.grad_year >= ${filters.yearFrom}`}
      ${filters.yearTo === undefined ? sql`` : sql`and p.grad_year <= ${filters.yearTo}`}
      ${filters.tag ? sql`and ${filters.tag} = any(v.top_tags)` : sql``}`,
    db,
  );
}

/** People the member liked today, in any mode, so they can still send a request. */
export function listLikedToday(userId: string, day: string, db: DbOrTx = getDb()): Promise<DeckCardRow[]> {
  return deckRows(userId, day, sql`s.action = 'liked'`, db);
}

/** Records Like or Skip on one of the member's own unanswered suggestions; false if already answered. */
export async function actOnSuggestion(
  userId: string,
  suggestionId: string,
  action: 'liked' | 'skipped',
  now: Date,
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(matchSuggestions)
    .set({ action, actedAt: now })
    .where(and(eq(matchSuggestions.id, suggestionId), eq(matchSuggestions.userId, userId), isNull(matchSuggestions.action)))
    .returning({ id: matchSuggestions.id });
  return rows.length > 0;
}

/**
 * Marks one of the member's suggestions as requested, from the deck or from their liked list, and
 * returns the candidate; null when it is not theirs or a request or skip was already recorded.
 */
export async function markSuggestionRequested(userId: string, suggestionId: string, now: Date, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db
    .update(matchSuggestions)
    .set({ action: 'requested', actedAt: now })
    .where(
      and(
        eq(matchSuggestions.id, suggestionId),
        eq(matchSuggestions.userId, userId),
        or(isNull(matchSuggestions.action), eq(matchSuggestions.action, 'liked')),
      ),
    )
    .returning({ candidateUserId: matchSuggestions.candidateUserId });
  return row?.candidateUserId ?? null;
}

/** Whether today's decks were built for the member at all (to tell "none today" from "seen everyone"). */
export async function hasDeckToday(userId: string, day: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: matchSuggestions.id })
    .from(matchSuggestions)
    .where(and(eq(matchSuggestions.userId, userId), eq(matchSuggestions.shownOn, day)))
    .limit(1);
  return row !== undefined;
}

export type PersonaSnapshotInput = {
  windowStart: Date | null;
  windowEnd: Date | null;
  metrics: Record<string, unknown>;
  labels: string[];
  companion: SnapshotCompanion;
};

/** Replaces a member's persona snapshot with the one from their latest Dev Card (§7.4). */
export async function upsertPersonaSnapshot(userId: string, snapshot: PersonaSnapshotInput, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(personaSnapshots)
    .values({ userId, ...snapshot, computedAt: now })
    .onConflictDoUpdate({ target: personaSnapshots.userId, set: { ...snapshot, computedAt: now } });
}

/** The language most of a member's own repositories are written in, by count, then by latest push. */
export async function memberTopLanguage(githubId: number, db: DbOrTx = getDb()): Promise<string | null> {
  const rows = await db.execute<{ language: string }>(sql`
    select primary_language as language from gh_repos
    where owner_github_id = ${githubId} and not is_fork and primary_language is not null
    group by primary_language
    order by count(*) desc, max(pushed_at) desc nulls last, primary_language
    limit 1`);
  return rows[0]?.language ?? null;
}

/** A member's persona snapshot, if they have one; `hourHistUtc` is null unless it is a valid histogram. */
export async function getPersonaSnapshot(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(personaSnapshots).where(eq(personaSnapshots.userId, userId));
  if (!row) return null;
  const hist = row.metrics.hourHistUtc;
  return { ...row, hourHistUtc: isHourHistogram(hist) ? hist : null };
}
