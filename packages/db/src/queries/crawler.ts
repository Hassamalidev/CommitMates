import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { crawlCursors, crawlOptouts, ghUsers } from '../schema';

export type CrawlSeed = { seed: string; countryCode: string };

/**
 * Where to crawl (CLAUDE.md §8 F18 "Seeds"): the countries of universities with verified members,
 * and the cities of members' resolved GitHub locations with at least `minCityMembers` members.
 */
export async function crawlSeeds(minCityMembers: number, db: DbOrTx = getDb()): Promise<CrawlSeed[]> {
  const rows = await db.execute<{ seed: string; country_code: string }>(sql`
    select distinct u.country as seed, u.country_code from universities u
    join profiles p on p.university_id = u.id
    where p.verified_at is not null
    union
    select g.city as seed, g.country_code from gh_users gu
    join geocode_cache g on g.query_norm = gu.geocode_key
    where gu.is_member and g.status = 'resolved' and g.city is not null and g.country_code is not null
    group by g.city, g.country_code having count(*) >= ${minCityMembers}
    order by country_code, seed`);
  return rows.map((row) => ({ seed: row.seed, countryCode: row.country_code.toUpperCase() }));
}

export type CrawlCursor = typeof crawlCursors.$inferSelect;

/**
 * Makes sure each seed's whole account-creation range up to `today` is covered: a first cursor from
 * `from`, or one more from the day after the latest covered day (new accounts since the last pass).
 */
export async function extendCursors(seeds: readonly CrawlSeed[], from: string, today: string, db: DbOrTx = getDb()): Promise<number> {
  let added = 0;
  for (const seed of seeds) {
    const [row] = await db.execute<{ latest: string | null }>(sql`
      select max(created_to)::text as latest from crawl_cursors where seed = ${seed.seed} and country_code = ${seed.countryCode}`);
    const start = row?.latest ? addDay(row.latest) : from;
    if (start > today) continue;
    const inserted = await db
      .insert(crawlCursors)
      .values({ seed: seed.seed, countryCode: seed.countryCode, createdFrom: start, createdTo: today })
      .onConflictDoNothing()
      .returning({ id: crawlCursors.id });
    added += inserted.length;
  }
  return added;
}

/** `YYYY-MM-DD` one day later. */
export const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); // allowed-literal: ms per day

/** The next cursor to work on: one under way or waiting, else a finished one due for its refresh pass. */
export async function nextCrawlCursor(refreshBefore: Date, db: DbOrTx = getDb()): Promise<CrawlCursor | null> {
  const [waiting] = await db.execute<{ id: string }>(sql`
    select id from crawl_cursors where status in ('pending', 'running') order by status desc, updated_at limit 1`);
  if (!waiting) {
    const [due] = await db.execute<{ id: string }>(sql`
      update crawl_cursors set status = 'pending', page = 0
      where id = (select id from crawl_cursors
                  -- Only cursors that were crawled; a split one is covered by its halves.
                  where status = 'done' and crawled_at is not null and crawled_at < ${refreshBefore.toISOString()}::timestamptz
                  order by crawled_at limit 1)
      returning id`);
    if (!due) return null;
    return (await db.select().from(crawlCursors).where(eq(crawlCursors.id, due.id)))[0] ?? null;
  }
  return (await db.select().from(crawlCursors).where(eq(crawlCursors.id, waiting.id)))[0] ?? null;
}

export async function updateCrawlCursor(
  id: string,
  change: Partial<Pick<CrawlCursor, 'page' | 'totalCount' | 'status' | 'crawledAt'>>,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.update(crawlCursors).set(change).where(eq(crawlCursors.id, id));
}

/**
 * Splits a cursor whose range holds more accounts than search returns (§8 F18 "Crawl" step 2): two
 * halves become new cursors and this one is done.
 */
export async function splitCrawlCursor(cursor: CrawlCursor, totalCount: number, middle: string, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(crawlCursors).set({ status: 'splitting', totalCount }).where(eq(crawlCursors.id, cursor.id));
    await tx
      .insert(crawlCursors)
      .values([
        { seed: cursor.seed, countryCode: cursor.countryCode, createdFrom: cursor.createdFrom, createdTo: middle },
        { seed: cursor.seed, countryCode: cursor.countryCode, createdFrom: addDay(middle), createdTo: cursor.createdTo },
      ])
      .onConflictDoNothing();
    await tx.update(crawlCursors).set({ status: 'done' }).where(eq(crawlCursors.id, cursor.id));
  });
}

/** Which of these logins asked not to be crawled (§8 F18 "Privacy"). */
export async function optedOutLogins(logins: readonly string[], db: DbOrTx = getDb()): Promise<Set<string>> {
  if (logins.length === 0) return new Set();
  const rows = await db.select({ login: crawlOptouts.githubLogin }).from(crawlOptouts).where(inArray(crawlOptouts.githubLogin, [...logins]));
  return new Set(rows.map((row) => row.login.toLowerCase()));
}

/**
 * Adds crawled accounts to a country's index with only what search returns (login and id). An
 * account already known keeps its other fields and loses any expiry: the index is refreshed by the
 * crawler, not purged (§5.12 class E). Returns the ids that were not in the index before.
 */
export async function addToCountryIndex(users: readonly { githubId: number; login: string }[], countryCode: string, now: Date, db: DbOrTx = getDb()): Promise<number[]> {
  if (users.length === 0) return [];
  return db.transaction(async (tx) => {
    const known = await tx
      .select({ githubId: ghUsers.githubId })
      .from(ghUsers)
      .where(and(inArray(ghUsers.githubId, users.map((user) => user.githubId)), eq(ghUsers.inCountryIndex, true)));
    const already = new Set(known.map((row) => row.githubId));
    // A renamed account can leave its old login on another row; logins are unique.
    await tx.execute(sql`
      delete from gh_users where login in (${sql.join(users.map((user) => sql`${user.login}`), sql`, `)})
        and github_id not in (${sql.join(users.map((user) => sql`${user.githubId}`), sql`, `)})`);
    await tx
      .insert(ghUsers)
      .values(users.map((user) => ({ githubId: user.githubId, login: user.login, inCountryIndex: true, indexCountryCode: countryCode, fetchedAt: now, expiresAt: null })))
      .onConflictDoUpdate({
        target: ghUsers.githubId,
        set: { login: sql`excluded.login`, inCountryIndex: true, indexCountryCode: sql`excluded.index_country_code`, expiresAt: null },
      });
    return users.map((user) => user.githubId).filter((id) => !already.has(id));
  });
}

/** Accounts and repositories in the country index, for the storage guard (§8 F18 step 5). */
export async function countryIndexCounts(db: DbOrTx = getDb()): Promise<{ users: number; repos: number }> {
  const [row] = await db.execute<{ users: string; repos: string }>(sql`
    select (select count(*) from gh_users where in_country_index) as users,
           (select count(*) from gh_repos r join gh_users u on u.github_id = r.owner_github_id where u.in_country_index and not u.is_member) as repos`);
  return { users: Number(row?.users ?? 0), repos: Number(row?.repos ?? 0) };
}

/**
 * Prunes the country index back under its limits (§8 F18 step 5): the oldest-fetched repositories with
 * the fewest stars first, then the oldest-fetched accounts with the fewest followers and their
 * repositories. Members' own rows are never touched.
 */
export async function pruneCountryIndex(targets: { users: number; repos: number }, db: DbOrTx = getDb()): Promise<{ users: number; repos: number }> {
  return db.transaction(async (tx) => {
    const repos = await tx.execute<{ github_id: string }>(sql`
      with indexed as (
        select r.github_id, row_number() over (order by r.fetched_at desc, r.stars desc, r.github_id) as keep_rank
        from gh_repos r join gh_users u on u.github_id = r.owner_github_id
        where u.in_country_index and not u.is_member)
      delete from gh_repos where github_id in (select github_id from indexed where keep_rank > ${targets.repos}) returning github_id`);
    const users = await tx.execute<{ github_id: string }>(sql`
      with indexed as (
        select github_id, row_number() over (order by fetched_at desc, followers desc, github_id) as keep_rank
        from gh_users where in_country_index and not is_member)
      delete from gh_users where github_id in (select github_id from indexed where keep_rank > ${targets.users}) returning github_id`);
    if (users.length > 0) {
      await tx.execute(sql`delete from gh_repos where owner_github_id in (${sql.join(users.map((row) => sql`${row.github_id}`), sql`, `)})`);
    }
    return { users: users.length, repos: repos.length };
  });
}

/** Removes an indexed account GitHub no longer has, with its repositories; members are left alone. */
export async function removeFromCountryIndex(githubId: number, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ isMember: ghUsers.isMember }).from(ghUsers).where(eq(ghUsers.githubId, githubId));
    if (!user || user.isMember) return;
    await tx.execute(sql`delete from gh_repos where owner_github_id = ${githubId}`);
    await tx.delete(ghUsers).where(eq(ghUsers.githubId, githubId));
  });
}

/** An indexed account's login, for its repository fetch; null when it left the index. */
export async function indexedLogin(githubId: number, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.select({ login: ghUsers.login }).from(ghUsers).where(and(eq(ghUsers.githubId, githubId), eq(ghUsers.inCountryIndex, true)));
  return row?.login ?? null;
}

/**
 * Honors an opt-out (§8 F18 "Privacy"): the login is recorded and, unless it belongs to a member,
 * its index rows are deleted now.
 */
export async function optOutOfIndex(login: string, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(crawlOptouts).values({ githubLogin: login }).onConflictDoNothing();
    const rows = await tx.select({ githubId: ghUsers.githubId }).from(ghUsers).where(and(eq(ghUsers.login, login), eq(ghUsers.inCountryIndex, true), eq(ghUsers.isMember, false)));
    for (const row of rows) {
      await tx.execute(sql`delete from gh_repos where owner_github_id = ${row.githubId}`);
      await tx.delete(ghUsers).where(eq(ghUsers.githubId, row.githubId));
    }
  });
}

export type CrawlerStatus = { cursors: Record<string, number>; seeds: number; users: number; repos: number; optouts: number };

/** What `/admin/crawler` shows: cursors by status, seeds covered, index size and opt-outs. */
export async function crawlerStatus(db: DbOrTx = getDb()): Promise<CrawlerStatus> {
  const [byStatus, [extra], counts] = await Promise.all([
    db.execute<{ status: string; count: string }>(sql`select status, count(*) from crawl_cursors group by status`),
    db.execute<{ seeds: string; optouts: string }>(sql`
      select (select count(*) from (select distinct seed, country_code from crawl_cursors) s) as seeds,
             (select count(*) from crawl_optouts) as optouts`),
    countryIndexCounts(db),
  ]);
  return {
    cursors: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.count)])),
    seeds: Number(extra?.seeds ?? 0),
    users: counts.users,
    repos: counts.repos,
    optouts: Number(extra?.optouts ?? 0),
  };
}

export type CountryCandidate = {
  githubId: number;
  fullName: string;
  description: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  licenseSpdx: string | null;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: Date | null;
  sizeKb: number | null;
  relevance: number;
};

/**
 * Repositories of a country's indexed developers that match a search (CLAUDE.md §8 F7 step 2,
 * country scope): full-text match on name, description and topics, or a topic shared with the
 * query's expansion; relevance = `ts_rank_cd` plus shared topics, best first.
 */
export async function countryRepoCandidates(countryCode: string, query: string, topics: readonly string[], limit: number, db: DbOrTx = getDb()): Promise<CountryCandidate[]> {
  const topicList = topics.length === 0 ? sql`array[]::text[]` : sql`array[${sql.join(topics.map((topic) => sql`${topic}`), sql`, `)}]::text[]`;
  const text = sql`websearch_to_tsquery('simple', ${query})`;
  const rows = await db.execute<{
    github_id: string;
    full_name: string;
    description: string | null;
    topics: string[] | null;
    stars: number | null;
    forks: number | null;
    open_issues: number | null;
    license_spdx: string | null;
    is_archived: boolean | null;
    is_fork: boolean | null;
    pushed_at: string | null;
    size_kb: number | null;
    relevance: number;
  }>(sql`
    select r.github_id, r.full_name, r.description, r.topics, r.stars, r.forks, r.open_issues, r.license_spdx, r.is_archived, r.is_fork,
           r.pushed_at, r.size_kb,
           (ts_rank_cd(r.search_tsv, ${text}) + cardinality(array(select unnest(coalesce(r.topics, '{}')) intersect select unnest(${topicList}))))::float8 as relevance
    from gh_repos r join gh_users u on u.github_id = r.owner_github_id
    where u.in_country_index and u.index_country_code = ${countryCode.toUpperCase()}
      and (r.search_tsv @@ ${text} or coalesce(r.topics, '{}') && ${topicList})
    order by relevance desc, r.stars desc nulls last, r.full_name
    limit ${limit}`);
  return rows.map((row) => ({
    githubId: Number(row.github_id),
    fullName: row.full_name,
    description: row.description,
    topics: row.topics ?? [],
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    openIssues: row.open_issues ?? 0,
    licenseSpdx: row.license_spdx,
    isArchived: row.is_archived ?? false,
    isFork: row.is_fork ?? false,
    pushedAt: row.pushed_at === null ? null : new Date(row.pushed_at),
    sizeKb: row.size_kb,
    relevance: row.relevance,
  }));
}
