import { and, desc, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { leaderboardOptins, leaderboardSnapshots } from '../schema';

/** Universities with enough verified members to appear (CLAUDE.md §8 F19 "Tier"), with their country. */
export async function leaderboardUniversities(minMembers: number, db: DbOrTx = getDb()): Promise<{ id: string; countryCode: string }[]> {
  const rows = await db.execute<{ id: string; country_code: string }>(sql`
    select u.id, u.country_code from universities u
    join profiles p on p.university_id = u.id
    where p.verified_at is not null
    group by u.id, u.country_code having count(*) >= ${minMembers}
    order by u.id`);
  return rows.map((row) => ({ id: row.id, countryCode: row.country_code }));
}

export type BoardMember = { userId: string; login: string; departmentId: string | null; hasToken: boolean; optedIn: boolean };

/** Verified, active members of a university with what the weekly count needs. */
export async function boardMembers(universityId: string, db: DbOrTx = getDb()): Promise<BoardMember[]> {
  const rows = await db.execute<{ user_id: string; login: string; department_id: string | null; has_token: boolean; opted_in: boolean }>(sql`
    select p.user_id, gi.login, p.department_id, (gi.token_enc is not null and not gi.token_invalid) as has_token,
           exists (select 1 from leaderboard_optins o where o.user_id = p.user_id) as opted_in
    from profiles p
    join users u on u.id = p.user_id
    join github_identities gi on gi.user_id = p.user_id
    where p.university_id = ${universityId} and p.verified_at is not null and u.status = 'active'
    order by p.user_id`);
  return rows.map((row) => ({ userId: row.user_id, login: row.login, departmentId: row.department_id, hasToken: row.has_token, optedIn: row.opted_in }));
}

/**
 * The week's revivals and helpful reviews per member of a university (§8 F19 step 3): adoptions
 * revived in the week by an adopter there, and reviews they wrote that settled as helpful in the week.
 */
export async function weeklyContributions(
  universityId: string,
  from: Date,
  to: Date,
  db: DbOrTx = getDb(),
): Promise<{ revivals: Map<string, number>; helpfulReviews: Map<string, number> }> {
  const [revived, helpful] = await Promise.all([
    db.execute<{ user_id: string; count: string }>(sql`
      select a.adopter_user_id as user_id, count(*) from adoptions a join profiles p on p.user_id = a.adopter_user_id
      where p.university_id = ${universityId} and a.status = 'revived'
        and a.revived_at >= ${from.toISOString()}::timestamptz and a.revived_at < ${to.toISOString()}::timestamptz
      group by a.adopter_user_id`),
    db.execute<{ user_id: string; count: string }>(sql`
      select rv.reviewer_user_id as user_id, count(*) from reviews rv
      join review_requests rr on rr.id = rv.request_id
      where rr.university_id = ${universityId} and rr.status = 'settled_helpful'
        and rr.updated_at >= ${from.toISOString()}::timestamptz and rr.updated_at < ${to.toISOString()}::timestamptz
      group by rv.reviewer_user_id`),
  ]);
  const toMap = (rows: readonly { user_id: string; count: string }[]) => new Map(rows.map((row) => [row.user_id, Number(row.count)]));
  return { revivals: toMap(revived), helpfulReviews: toMap(helpful) };
}

export type BoardRow = {
  scope: 'university' | 'department' | 'member';
  scopeId: string;
  groupId: string;
  weekStart: string;
  metrics: Record<string, number>;
  score: number;
  rank: number;
};

/** Writes (or replaces) a week's rows. */
export async function upsertBoardRows(rows: readonly BoardRow[], db: DbOrTx = getDb()): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(leaderboardSnapshots)
    .values([...rows])
    .onConflictDoUpdate({
      target: [leaderboardSnapshots.scope, leaderboardSnapshots.scopeId, leaderboardSnapshots.weekStart],
      set: { groupId: sql`excluded.group_id`, metrics: sql`excluded.metrics`, score: sql`excluded.score`, rank: sql`excluded.rank` },
    });
}

/** Every row of one board (a scope within a group) for a week. */
export async function boardRows(scope: BoardRow['scope'], groupId: string, weekStart: string, db: DbOrTx = getDb()): Promise<(BoardRow & { id: string })[]> {
  const rows = await db
    .select()
    .from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.scope, scope), eq(leaderboardSnapshots.groupId, groupId), eq(leaderboardSnapshots.weekStart, weekStart)));
  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    groupId: row.groupId,
    weekStart: row.weekStart,
    metrics: row.metrics as Record<string, number>,
    score: row.score,
    rank: row.rank,
  }));
}

/** Locks a board while it is re-ranked, so two universities finishing at once do not interleave. */
export async function lockBoard(scope: BoardRow['scope'], groupId: string, weekStart: string, db: DbOrTx): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`leaderboard:${scope}:${groupId}:${weekStart}`}))`);
}

/** The latest week that has rows for a board, and the one before it (for rank changes). */
export async function latestBoardWeeks(scope: BoardRow['scope'], groupId: string, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ weekStart: leaderboardSnapshots.weekStart })
    .from(leaderboardSnapshots)
    .where(and(eq(leaderboardSnapshots.scope, scope), eq(leaderboardSnapshots.groupId, groupId)))
    .orderBy(desc(leaderboardSnapshots.weekStart))
    .limit(2);
  return rows.map((row) => row.weekStart);
}

export async function setLeaderboardOptin(userId: string, optIn: boolean, db: DbOrTx = getDb()): Promise<void> {
  if (optIn) await db.insert(leaderboardOptins).values({ userId }).onConflictDoNothing();
  else {
    await db.transaction(async (tx) => {
      await tx.delete(leaderboardOptins).where(eq(leaderboardOptins.userId, userId));
      // Leaving the board removes the member's rows from it.
      await tx.execute(sql`delete from leaderboard_snapshots where scope = 'member' and scope_id = ${userId}`);
    });
  }
}

export async function isLeaderboardOptedIn(userId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db.select({ userId: leaderboardOptins.userId }).from(leaderboardOptins).where(eq(leaderboardOptins.userId, userId));
  return row !== undefined;
}

export type NamedBoardRow = {
  scopeId: string;
  name: string;
  /** The university's slug, for its page; null for departments and members. */
  slug: string | null;
  metrics: Record<string, number>;
  score: number;
  rank: number;
  previousRank: number | null;
  companion: { seed: number; speciesKey: string; paletteHex: string | null; stage: number; traits: string[] } | null;
};

/**
 * One board's rows for a week with their display names (§8 F19 "UI"): university names, department
 * names, or members' logins with their Dev Card companion; and each entry's rank the week before.
 */
export async function namedBoardRows(scope: BoardRow['scope'], groupId: string, week: string, previousWeek: string | null, db: DbOrTx = getDb()): Promise<NamedBoardRow[]> {
  const name =
    scope === 'university'
      ? sql`(select u.name from universities u where u.id = s.scope_id)`
      : scope === 'department'
        ? sql`(select d.name from departments d where d.id = s.scope_id)`
        : sql`(select gi.login from github_identities gi where gi.user_id = s.scope_id)`;
  const slug = scope === 'university' ? sql`(select u.slug from universities u where u.id = s.scope_id)` : sql`null`;
  const companion = scope === 'member' ? sql`(select ps.companion from persona_snapshots ps where ps.user_id = s.scope_id)` : sql`null`;
  const rows = await db.execute<{
    scope_id: string;
    name: string | null;
    slug: string | null;
    metrics: Record<string, number>;
    score: number;
    rank: number;
    previous_rank: number | null;
    companion: NamedBoardRow['companion'];
  }>(sql`
    select s.scope_id, ${name} as name, ${slug} as slug, s.metrics, s.score, s.rank,
           (select p.rank from leaderboard_snapshots p where p.scope = s.scope and p.scope_id = s.scope_id and p.week_start = ${previousWeek}) as previous_rank,
           ${companion} as companion
    from leaderboard_snapshots s
    where s.scope = ${scope} and s.group_id = ${groupId} and s.week_start = ${week}
    order by s.rank, name`);
  return rows.flatMap((row) =>
    row.name === null
      ? []
      : [{ scopeId: row.scope_id, name: row.name, slug: row.slug, metrics: row.metrics, score: row.score, rank: row.rank, previousRank: row.previous_rank, companion: row.companion }],
  );
}
