import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { ghRepos, graveyardListings, listingSuggestions } from '../schema';

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

export type ListingView = OwnRepo & { listingId: string; status: 'listed' | 'adopted' | 'withdrawn'; note: string | null; listedAt: Date };

/** A member's listings that are listed or adopted, newest first. */
export async function memberListings(ownerUserId: string, db: DbOrTx = getDb()): Promise<ListingView[]> {
  return db
    .select({
      ...ownRepoColumns,
      listingId: graveyardListings.id,
      status: graveyardListings.status,
      note: graveyardListings.note,
      listedAt: graveyardListings.listedAt,
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
