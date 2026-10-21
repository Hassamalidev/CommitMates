import { and, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { ghRepos, legacyEntries, type SnapshotCompanion } from '../schema';

/** Entries counted toward `unlock.legacy.minProjects`: those of active members whose profile is not hidden. */
export async function countLegacyEntries(universityId: string, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`
    select count(*) from legacy_entries le
    join profiles p on p.user_id = le.owner_user_id
    join users u on u.id = le.owner_user_id
    where le.university_id = ${universityId} and u.status = 'active' and p.visibility <> 'hidden'`);
  return Number(rows[0]?.count ?? 0);
}

/** Adds a showcase entry, or updates its blurb and question setting when it exists. */
export async function upsertLegacyEntry(
  entry: { universityId: string; ownerUserId: string; repoGithubId: number; gradYear: number | null; tags: string[]; blurb: string | null; acceptsQuestions: boolean },
  db: DbOrTx = getDb(),
): Promise<string> {
  const [row] = await db
    .insert(legacyEntries)
    .values({ ...entry, source: 'showcase' })
    .onConflictDoUpdate({
      target: [legacyEntries.ownerUserId, legacyEntries.repoGithubId],
      set: { blurb: entry.blurb, acceptsQuestions: entry.acceptsQuestions, tags: entry.tags, gradYear: entry.gradYear, universityId: entry.universityId },
    })
    .returning({ id: legacyEntries.id });
  if (!row) throw new Error('legacy entry upsert returned no row');
  return row.id;
}

export async function deleteLegacyEntry(ownerUserId: string, entryId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .delete(legacyEntries)
    .where(and(eq(legacyEntries.id, entryId), eq(legacyEntries.ownerUserId, ownerUserId)))
    .returning({ id: legacyEntries.id });
  return rows.length > 0;
}

export type LegacyEntryView = {
  id: string;
  universityId: string;
  ownerUserId: string;
  ownerLogin: string;
  ownerGithubId: number;
  /** The owner's Dev Card companion, when they have a snapshot. */
  companion: SnapshotCompanion | null;
  ownerRole: 'student' | 'alumni' | 'supervisor_pending' | 'supervisor';
  gradYear: number | null;
  department: string | null;
  repoGithubId: number;
  fullName: string;
  description: string | null;
  topics: string[];
  primaryLanguage: string | null;
  stars: number;
  tags: string[];
  blurb: string | null;
  acceptsQuestions: boolean;
  relevance: number;
  createdAt: Date;
};

type RawEntry = {
  id: string;
  university_id: string;
  owner_user_id: string;
  login: string;
  github_id: string;
  companion: SnapshotCompanion | null;
  role: LegacyEntryView['ownerRole'];
  grad_year: number | null;
  department: string | null;
  repo_github_id: string;
  full_name: string;
  description: string | null;
  topics: string[] | null;
  primary_language: string | null;
  stars: number | null;
  tags: string[];
  blurb: string | null;
  accepts_questions: boolean;
  relevance: number;
  created_at: string;
};

const toEntry = (row: RawEntry): LegacyEntryView => ({
  id: row.id,
  universityId: row.university_id,
  ownerUserId: row.owner_user_id,
  ownerLogin: row.login,
  ownerGithubId: Number(row.github_id),
  companion: row.companion,
  ownerRole: row.role,
  gradYear: row.grad_year,
  department: row.department,
  repoGithubId: Number(row.repo_github_id),
  fullName: row.full_name,
  description: row.description,
  topics: row.topics ?? [],
  primaryLanguage: row.primary_language,
  stars: row.stars ?? 0,
  tags: row.tags,
  blurb: row.blurb,
  acceptsQuestions: row.accepts_questions,
  relevance: row.relevance,
  createdAt: new Date(row.created_at),
});

const entryColumns = sql`
  le.id, le.university_id, le.owner_user_id, gi.login, gi.github_id, ps.companion, p.role, coalesce(le.grad_year, p.grad_year) as grad_year, d.name as department,
  le.repo_github_id, r.full_name, r.description, r.topics, r.primary_language, r.stars, le.tags, le.blurb, le.accepts_questions, le.created_at`;
const entryJoins = sql`
  join gh_repos r on r.github_id = le.repo_github_id
  join profiles p on p.user_id = le.owner_user_id
  join users u on u.id = le.owner_user_id
  join github_identities gi on gi.user_id = le.owner_user_id
  left join departments d on d.id = p.department_id
  left join persona_snapshots ps on ps.user_id = le.owner_user_id`;

export type LegacySearch = {
  query: string | null;
  /** Topics from the query's taxonomy expansion; an entry sharing one matches. */
  topics: readonly string[];
  tag: string | null;
  gradFrom: number | null;
  gradTo: number | null;
  departmentId: string | null;
  sort: 'relevance' | 'stars';
  limit: number;
};

/**
 * Entries at a university (CLAUDE.md §8 F17 "Search"): owners active and not hidden, nobody either
 * side has blocked. With a query, entries whose repository text or blurb match it, or whose tags
 * share a topic of its expansion; relevance = text rank plus shared topics.
 */
export async function searchLegacyEntries(universityId: string, viewerId: string, search: LegacySearch, db: DbOrTx = getDb()): Promise<LegacyEntryView[]> {
  const topics = search.topics.length === 0 ? sql`array[]::text[]` : sql`array[${sql.join(search.topics.map((topic) => sql`${topic}`), sql`, `)}]::text[]`;
  const document = sql`(r.search_tsv || to_tsvector('simple', coalesce(le.blurb, '')))`;
  const text = search.query === null ? null : sql`websearch_to_tsquery('simple', ${search.query})`;
  const relevance =
    text === null
      ? sql`0::float8`
      : sql`(ts_rank_cd(${document}, ${text}) + cardinality(array(select unnest(le.tags) intersect select unnest(${topics}))))::float8`;
  const matches = text === null ? sql`true` : sql`(${document} @@ ${text} or le.tags && ${topics})`;
  const rows = await db.execute<RawEntry>(sql`
    select ${entryColumns}, ${relevance} as relevance
    from legacy_entries le ${entryJoins}
    where le.university_id = ${universityId} and u.status = 'active' and p.visibility <> 'hidden' and ${matches}
      and not exists (select 1 from blocks b where (b.blocker = ${viewerId} and b.blocked = le.owner_user_id)
                                              or (b.blocker = le.owner_user_id and b.blocked = ${viewerId}))
      ${search.tag === null ? sql`` : sql`and ${search.tag} = any(le.tags)`}
      ${search.gradFrom === null ? sql`` : sql`and coalesce(le.grad_year, p.grad_year) >= ${search.gradFrom}`}
      ${search.gradTo === null ? sql`` : sql`and coalesce(le.grad_year, p.grad_year) <= ${search.gradTo}`}
      ${search.departmentId === null ? sql`` : sql`and p.department_id = ${search.departmentId}`}
    order by ${search.sort === 'stars' ? sql`r.stars desc nulls last,` : sql``} relevance desc, r.stars desc nulls last, le.created_at desc
    limit ${search.limit}`);
  return rows.map(toEntry);
}

/** One entry, for its detail view; null when it does not exist. */
export async function getLegacyEntry(entryId: string, db: DbOrTx = getDb()): Promise<(LegacyEntryView & { ownerVisible: boolean }) | null> {
  const rows = await db.execute<RawEntry & { owner_visible: boolean }>(sql`
    select ${entryColumns}, 0::float8 as relevance, (u.status = 'active' and p.visibility <> 'hidden') as owner_visible
    from legacy_entries le ${entryJoins} where le.id = ${entryId}`);
  const row = rows[0];
  return row ? { ...toEntry(row), ownerVisible: row.owner_visible } : null;
}

/** A member's own entries, newest first. */
export async function memberLegacyEntries(ownerUserId: string, db: DbOrTx = getDb()): Promise<LegacyEntryView[]> {
  const rows = await db.execute<RawEntry>(sql`
    select ${entryColumns}, 0::float8 as relevance from legacy_entries le ${entryJoins}
    where le.owner_user_id = ${ownerUserId} order by le.created_at desc`);
  return rows.map(toEntry);
}

/** Every entry with its repository and owner's GitHub id, for the weekly refresh. */
export async function legacyEntriesForRefresh(db: DbOrTx = getDb()): Promise<{ id: string; repoGithubId: number; ownerGithubId: number | null }[]> {
  const rows = await db.execute<{ id: string; repo_github_id: string; owner_github_id: string | null }>(sql`
    select le.id, le.repo_github_id, gi.github_id as owner_github_id
    from legacy_entries le left join github_identities gi on gi.user_id = le.owner_user_id order by le.id`);
  return rows.map((row) => ({ id: row.id, repoGithubId: Number(row.repo_github_id), ownerGithubId: row.owner_github_id === null ? null : Number(row.owner_github_id) }));
}

export async function setLegacyTags(entryId: string, tags: readonly string[], db: DbOrTx = getDb()): Promise<void> {
  await db.update(legacyEntries).set({ tags: [...tags] }).where(eq(legacyEntries.id, entryId));
}

export async function deleteLegacyEntryById(entryId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.delete(legacyEntries).where(eq(legacyEntries.id, entryId));
}

/** Refreshes the repository fields an entry shows (§8 F17 "Indexing"). */
export async function refreshRepoMetadata(
  repo: { githubId: number; fullName: string; description: string | null; topics: string[]; primaryLanguage: string | null; stars: number; forks: number; pushedAt: Date | null },
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db
    .update(ghRepos)
    .set({
      fullName: repo.fullName,
      description: repo.description,
      topics: repo.topics,
      primaryLanguage: repo.primaryLanguage,
      stars: repo.stars,
      forks: repo.forks,
      pushedAt: repo.pushedAt,
      fetchedAt: now,
    })
    .where(eq(ghRepos.githubId, repo.githubId));
}
