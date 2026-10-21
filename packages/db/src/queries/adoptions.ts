import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { adoptions, ghRepos, graveyardListings, listingSuggestions } from '../schema';

export type OwnRepo = {
  githubId: number;
  fullName: string;
  description: string | null;
  pushedAt: Date | null;
  isArchived: boolean;
  licenseSpdx: string | null;
  stars: number;
};

const ownRepoColumns = {
  githubId: ghRepos.githubId,
  fullName: ghRepos.fullName,
  description: ghRepos.description,
  pushedAt: ghRepos.pushedAt,
  isArchived: ghRepos.isArchived,
  licenseSpdx: ghRepos.licenseSpdx,
  stars: ghRepos.stars,
};

/** A member's own repositories that are not forks, most recently pushed first. */
export async function memberOwnRepos(githubId: number, db: DbOrTx = getDb()): Promise<OwnRepo[]> {
  return db
    .select(ownRepoColumns)
    .from(ghRepos)
    .where(and(eq(ghRepos.ownerGithubId, githubId), eq(ghRepos.isFork, false)))
    .orderBy(desc(ghRepos.pushedAt), ghRepos.fullName);
}

/** Records a private suggestion; one that exists (or was dismissed) is left as it is. */
export async function addListingSuggestion(ownerUserId: string, repoGithubId: number, now: Date, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .insert(listingSuggestions)
    .values({ ownerUserId, repoGithubId, suggestedAt: now })
    .onConflictDoNothing()
    .returning({ repo: listingSuggestions.repoGithubId });
  return rows.length > 0;
}

/** Repositories of a member that are listed or adopted, or whose suggestion they dismissed. */
export async function settledRepoIds(ownerUserId: string, db: DbOrTx = getDb()): Promise<Set<number>> {
  const rows = await db.execute<{ repo_github_id: string }>(sql`
    select repo_github_id from graveyard_listings where owner_user_id = ${ownerUserId} and status <> 'withdrawn'
    union
    select repo_github_id from listing_suggestions where owner_user_id = ${ownerUserId} and dismissed_at is not null`);
  return new Set(rows.map((row) => Number(row.repo_github_id)));
}

export type SuggestionView = OwnRepo & { suggestedAt: Date };

/** A member's open suggestions (not dismissed, not listed), newest first: shown only to them. */
export async function openListingSuggestions(ownerUserId: string, db: DbOrTx = getDb()): Promise<SuggestionView[]> {
  return db
    .select({ ...ownRepoColumns, suggestedAt: listingSuggestions.suggestedAt })
    .from(listingSuggestions)
    .innerJoin(ghRepos, eq(ghRepos.githubId, listingSuggestions.repoGithubId))
    .where(
      and(
        eq(listingSuggestions.ownerUserId, ownerUserId),
        isNull(listingSuggestions.dismissedAt),
        sql`not exists (select 1 from graveyard_listings l where l.repo_github_id = ${listingSuggestions.repoGithubId} and l.status <> 'withdrawn')`,
      ),
    )
    .orderBy(desc(listingSuggestions.suggestedAt));
}

export async function dismissListingSuggestion(ownerUserId: string, repoGithubId: number, now: Date, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(listingSuggestions)
    .set({ dismissedAt: now })
    .where(and(eq(listingSuggestions.ownerUserId, ownerUserId), eq(listingSuggestions.repoGithubId, repoGithubId), isNull(listingSuggestions.dismissedAt)))
    .returning({ repo: listingSuggestions.repoGithubId });
  return rows.length > 0;
}

/** Lists a repository; null when it already has an open listing. */
export async function insertListing(ownerUserId: string, repoGithubId: number, note: string | null, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db
    .insert(graveyardListings)
    .values({ ownerUserId, repoGithubId, note })
    .onConflictDoNothing()
    .returning({ id: graveyardListings.id });
  return row?.id ?? null;
}

/** Withdraws one of the owner's own listings that is still listed. */
export async function withdrawListing(ownerUserId: string, listingId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(graveyardListings)
    .set({ status: 'withdrawn' })
    .where(and(eq(graveyardListings.id, listingId), eq(graveyardListings.ownerUserId, ownerUserId), eq(graveyardListings.status, 'listed')))
    .returning({ id: graveyardListings.id });
  return rows.length > 0;
}

export type ListingView = OwnRepo & {
  listingId: string;
  status: 'listed' | 'adopted' | 'withdrawn';
  note: string | null;
  listedAt: Date;
  /** The status of the listing's latest adoption, if anyone asked. */
  adoptionStatus: 'requested' | 'active' | 'revived' | 'dropped' | null;
};

/** A member's listings that are listed or adopted, newest first. */
export async function memberListings(ownerUserId: string, db: DbOrTx = getDb()): Promise<ListingView[]> {
  return db
    .select({
      ...ownRepoColumns,
      listingId: graveyardListings.id,
      status: graveyardListings.status,
      note: graveyardListings.note,
      listedAt: graveyardListings.listedAt,
      adoptionStatus: sql<ListingView['adoptionStatus']>`(
        select a.status from adoptions a where a.listing_id = ${graveyardListings.id} order by a.created_at desc limit 1)`,
    })
    .from(graveyardListings)
    .innerJoin(ghRepos, eq(ghRepos.githubId, graveyardListings.repoGithubId))
    .where(and(eq(graveyardListings.ownerUserId, ownerUserId), sql`${graveyardListings.status} <> 'withdrawn'`))
    .orderBy(desc(graveyardListings.listedAt));
}

/** Verified, active members with a GitHub identity: the weekly suggestion runs. */
export async function verifiedMembersWithGithub(db: DbOrTx = getDb()): Promise<{ userId: string; githubId: number }[]> {
  const rows = await db.execute<{ user_id: string; github_id: string }>(sql`
    select p.user_id, g.github_id from profiles p
    join users u on u.id = p.user_id
    join github_identities g on g.user_id = p.user_id
    where p.verified_at is not null and p.university_id is not null and u.status = 'active'
    order by p.user_id`);
  return rows.map((row) => ({ userId: row.user_id, githubId: Number(row.github_id) }));
}

export type UniListingCandidate = {
  listingId: string;
  note: string | null;
  ownerUserId: string;
  ownerLogin: string;
  githubId: number;
  fullName: string;
  description: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  licenseSpdx: string | null;
  isArchived: boolean;
  pushedAt: Date | null;
  sizeKb: number | null;
  /** Full-text rank plus one per expansion topic the repository carries. */
  relevance: number;
};

/**
 * Listings at a university that match a search (CLAUDE.md §8 F7 step 2 "Uni"): listed by an active
 * member of that university, not by the searcher, nobody blocked either way, matched by full text or
 * topic overlap with the expansion, best first.
 */
export async function uniListingCandidates(
  universityId: string,
  searcherId: string,
  query: string,
  topics: readonly string[],
  limit: number,
  db: DbOrTx = getDb(),
): Promise<UniListingCandidate[]> {
  // A Postgres array literal; topic slugs never contain quotes or backslashes, and any that did are dropped.
  const topicArray = `{${topics.map((topic) => `"${topic.replace(/["\\]/g, '')}"`).join(',')}}`;
  const rows = await db.execute<{
    listing_id: string;
    note: string | null;
    owner_user_id: string;
    owner_login: string;
    github_id: string;
    full_name: string;
    description: string | null;
    topics: string[] | null;
    stars: number | null;
    forks: number | null;
    open_issues: number | null;
    license_spdx: string | null;
    is_archived: boolean | null;
    pushed_at: string | null;
    size_kb: number | null;
    relevance: number;
  }>(sql`
    select l.id as listing_id, l.note, l.owner_user_id, g.login as owner_login, r.github_id, r.full_name, r.description, r.topics,
           r.stars, r.forks, r.open_issues, r.license_spdx, r.is_archived, r.pushed_at, r.size_kb,
           ts_rank_cd(r.search_tsv, websearch_to_tsquery('simple', ${query}))
             + cardinality(array(select unnest(coalesce(r.topics, '{}')) intersect select unnest(${topicArray}::text[]))) as relevance
    from graveyard_listings l
    join gh_repos r on r.github_id = l.repo_github_id
    join profiles p on p.user_id = l.owner_user_id
    join users u on u.id = l.owner_user_id
    join github_identities g on g.user_id = l.owner_user_id
    where l.status = 'listed' and p.university_id = ${universityId} and u.status = 'active' and l.owner_user_id <> ${searcherId}
      and not exists (select 1 from blocks b where (b.blocker = ${searcherId} and b.blocked = l.owner_user_id) or (b.blocker = l.owner_user_id and b.blocked = ${searcherId}))
      and (r.search_tsv @@ websearch_to_tsquery('simple', ${query}) or coalesce(r.topics, '{}') && ${topicArray}::text[])
    order by relevance desc, r.full_name
    limit ${limit}`);
  return rows.map((row) => ({
    listingId: row.listing_id,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerLogin: row.owner_login,
    githubId: Number(row.github_id),
    fullName: row.full_name,
    description: row.description,
    topics: row.topics ?? [],
    stars: row.stars ?? 0,
    forks: row.forks ?? 0,
    openIssues: row.open_issues ?? 0,
    licenseSpdx: row.license_spdx,
    isArchived: row.is_archived ?? false,
    pushedAt: row.pushed_at === null ? null : new Date(row.pushed_at),
    sizeKb: row.size_kb,
    relevance: row.relevance,
  }));
}

export type ListingForAdoption = { id: string; repoGithubId: number; ownerUserId: string; status: 'listed' | 'adopted' | 'withdrawn'; universityId: string | null };

/** A listing with its owner's university, for the adoption rules. */
export async function getListingForAdoption(listingId: string, db: DbOrTx = getDb()): Promise<ListingForAdoption | null> {
  const rows = await db.execute<{ id: string; repo_github_id: string; owner_user_id: string; status: ListingForAdoption['status']; university_id: string | null }>(sql`
    select l.id, l.repo_github_id, l.owner_user_id, l.status, p.university_id
    from graveyard_listings l join profiles p on p.user_id = l.owner_user_id
    where l.id = ${listingId}`);
  const row = rows[0];
  return row ? { id: row.id, repoGithubId: Number(row.repo_github_id), ownerUserId: row.owner_user_id, status: row.status, universityId: row.university_id } : null;
}

/** Whether the member already has an adoption of this repository that is requested or under way. */
export async function hasOpenAdoption(adopterUserId: string, repoGithubId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: adoptions.id })
    .from(adoptions)
    .where(and(eq(adoptions.adopterUserId, adopterUserId), eq(adoptions.repoGithubId, repoGithubId), sql`${adoptions.status} in ('requested', 'active')`));
  return row !== undefined;
}

export async function insertAdoption(adoption: { listingId: string | null; repoGithubId: number; adopterUserId: string }, db: DbOrTx = getDb()): Promise<string> {
  const [row] = await db.insert(adoptions).values(adoption).returning({ id: adoptions.id });
  if (!row) throw new Error('adoption insert returned no row');
  return row.id;
}

/**
 * Starts an adoption its owner accepted (§8 F14 "Adoption flow" step 2): the adoption becomes active
 * and its listing adopted. False when the adoption was not waiting.
 */
export async function activateAdoption(adoptionId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .update(adoptions)
    .set({ status: 'active', activatedAt: sql`now()` })
    .where(and(eq(adoptions.id, adoptionId), eq(adoptions.status, 'requested')))
    .returning({ listingId: adoptions.listingId });
  if (!row) return false;
  if (row.listingId) await db.update(graveyardListings).set({ status: 'adopted' }).where(eq(graveyardListings.id, row.listingId));
  return true;
}

/** Records the fork an adopter works in, on one of their own active or revived adoptions. */
export async function setAdoptionFork(adoptionId: string, adopterUserId: string, forkFullName: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(adoptions)
    .set({ forkFullName })
    .where(and(eq(adoptions.id, adoptionId), eq(adoptions.adopterUserId, adopterUserId), sql`${adoptions.status} in ('active', 'revived')`))
    .returning({ id: adoptions.id });
  return rows.length > 0;
}

export type AdoptionView = {
  id: string;
  status: 'requested' | 'active' | 'revived' | 'dropped';
  fullName: string | null;
  licenseSpdx: string | null;
  forkFullName: string | null;
  createdAt: Date;
};

/** Adoptions a member asked for, newest first, with the repository's name and license when known. */
export async function memberAdoptions(adopterUserId: string, db: DbOrTx = getDb()): Promise<AdoptionView[]> {
  const rows = await db.execute<{ id: string; status: AdoptionView['status']; full_name: string | null; license_spdx: string | null; fork_full_name: string | null; created_at: string }>(sql`
    select a.id, a.status, r.full_name, r.license_spdx, a.fork_full_name, a.created_at
    from adoptions a left join gh_repos r on r.github_id = a.repo_github_id
    where a.adopter_user_id = ${adopterUserId}
    order by a.created_at desc`);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    fullName: row.full_name,
    licenseSpdx: row.license_spdx,
    forkFullName: row.fork_full_name,
    createdAt: new Date(row.created_at),
  }));
}

/** Adoptions revival tracking still follows: asked for or under way (CLAUDE.md §8 F14 "Revival tracking"). */
export async function trackableAdoptionIds(db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.select({ id: adoptions.id }).from(adoptions).where(sql`${adoptions.status} in ('requested', 'active')`).orderBy(adoptions.createdAt);
  return rows.map((row) => row.id);
}

export type TrackedAdoption = {
  id: string;
  status: AdoptionView['status'];
  listingId: string | null;
  repoGithubId: number;
  repoFullName: string | null;
  adopterUserId: string;
  adopterLogin: string | null;
  /** The listing's owner, or the repository's owner when they are a member (never the adopter). */
  ownerUserId: string | null;
  forkFullName: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  /** The status of the message request that asked the owner, for a listing adoption. */
  requestStatus: 'pending' | 'accepted' | 'declined' | 'expired' | null;
};

/** One adoption with what revival tracking needs about it. */
export async function getTrackedAdoption(adoptionId: string, db: DbOrTx = getDb()): Promise<TrackedAdoption | null> {
  const rows = await db.execute<{
    id: string;
    status: AdoptionView['status'];
    listing_id: string | null;
    repo_github_id: string;
    full_name: string | null;
    adopter_user_id: string;
    adopter_login: string | null;
    owner_user_id: string | null;
    fork_full_name: string | null;
    created_at: string;
    activated_at: string | null;
    request_status: TrackedAdoption['requestStatus'];
  }>(sql`
    select a.id, a.status, a.listing_id, a.repo_github_id, r.full_name, a.adopter_user_id, adopter.login as adopter_login,
           coalesce(l.owner_user_id, owner.user_id) as owner_user_id, a.fork_full_name, a.created_at, a.activated_at,
           (select mr.status from message_requests mr where mr.context_kind = 'adoption' and mr.context_id = a.id::text
            order by mr.created_at desc limit 1) as request_status
    from adoptions a
    left join gh_repos r on r.github_id = a.repo_github_id
    left join graveyard_listings l on l.id = a.listing_id
    left join github_identities adopter on adopter.user_id = a.adopter_user_id
    left join github_identities owner on owner.github_id = r.owner_github_id
    where a.id = ${adoptionId}`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    listingId: row.listing_id,
    repoGithubId: Number(row.repo_github_id),
    repoFullName: row.full_name,
    adopterUserId: row.adopter_user_id,
    adopterLogin: row.adopter_login,
    ownerUserId: row.owner_user_id === row.adopter_user_id ? null : row.owner_user_id,
    forkFullName: row.fork_full_name,
    createdAt: new Date(row.created_at),
    activatedAt: row.activated_at === null ? null : new Date(row.activated_at),
    requestStatus: row.request_status,
  };
}

/**
 * Records a fork found for an adoption. One asked for from a global result becomes active with it;
 * an active one keeps its status. False when the adoption was in neither state.
 */
export async function recordDetectedFork(adoptionId: string, forkFullName: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    update adoptions
    set fork_full_name = ${forkFullName},
        status = case when status = 'requested' then 'active'::adoption_status else status end,
        activated_at = coalesce(activated_at, now())
    where id = ${adoptionId} and (status = 'active' or (status = 'requested' and listing_id is null))
    returning id`);
  return rows.length > 0;
}

/** An active adoption whose fork has enough new commits becomes revived. False when it was not active. */
export async function markAdoptionRevived(adoptionId: string, now: Date, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(adoptions)
    .set({ status: 'revived', revivedAt: now })
    .where(and(eq(adoptions.id, adoptionId), eq(adoptions.status, 'active')))
    .returning({ id: adoptions.id });
  return rows.length > 0;
}

/**
 * Ends an adoption that went nowhere. Its listing stays as it is: an adopted listing returns to the
 * Graveyard only when its owner lists it again (§8 F14 "if the owner agrees").
 */
export async function markAdoptionDropped(adoptionId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(adoptions)
    .set({ status: 'dropped' })
    .where(and(eq(adoptions.id, adoptionId), sql`${adoptions.status} in ('requested', 'active')`))
    .returning({ id: adoptions.id });
  return rows.length > 0;
}

/** Lists an adopted project again after its adoption was dropped. False when it is not the owner's or not dropped. */
export async function relistDroppedListing(ownerUserId: string, listingId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    update graveyard_listings l set status = 'listed'
    where l.id = ${listingId} and l.owner_user_id = ${ownerUserId} and l.status = 'adopted'
      and not exists (select 1 from adoptions a where a.listing_id = l.id and a.status in ('requested', 'active', 'revived'))
    returning l.id`);
  return rows.length > 0;
}

/**
 * Whether the member with this GitHub id took part in a revival, as adopter or owner: the "Revived"
 * badge and the companion's `reviver` trait (§8 F14, §9.5).
 */
export async function hasRevivalBadge(githubId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db.execute<{ found: boolean }>(sql`
    select exists (
      select 1
      from adoptions a
      left join graveyard_listings l on l.id = a.listing_id
      left join gh_repos r on r.github_id = a.repo_github_id
      join github_identities gi on gi.github_id = ${githubId}
      where a.status = 'revived'
        and (a.adopter_user_id = gi.user_id or l.owner_user_id = gi.user_id or r.owner_github_id = ${githubId})
    ) as found`);
  return rows[0]?.found ?? false;
}

/** Revivals so far, and those since `since` (CLAUDE.md §1.7 "Revivals"). */
export async function countRevivals(since: Date, db: DbOrTx = getDb()): Promise<{ total: number; recent: number }> {
  const rows = await db.execute<{ total: string; recent: string }>(sql`
    select count(*) as total, count(*) filter (where revived_at >= ${since.toISOString()}::timestamptz) as recent from adoptions where status = 'revived'`);
  return { total: Number(rows[0]?.total ?? 0), recent: Number(rows[0]?.recent ?? 0) };
}
