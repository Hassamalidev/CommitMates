import { eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { ossMemberContribs } from '../schema';

/** Replaces a member's merged pull requests per repository (CLAUDE.md §8 F8 step 5). */
export async function replaceMemberContribs(
  userId: string,
  rows: readonly { repoFullName: string; mergedPrs: number; lastMergedAt: Date | null }[],
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(ossMemberContribs).where(eq(ossMemberContribs.userId, userId));
    if (rows.length > 0) await tx.insert(ossMemberContribs).values(rows.map((row) => ({ userId, ...row, refreshedAt: now })));
  });
}

export type CampusContributor = { repoFullName: string; userId: string; login: string; mergedPrs: number };

/**
 * Verified, active members of a university who had pull requests merged into these repositories,
 * most merged first, at most `perRepo` each; never the viewer, nobody hidden or in ghost mode, and
 * nobody either side has blocked.
 */
export async function campusContributors(
  universityId: string,
  viewerId: string,
  repos: readonly string[],
  perRepo: number,
  db: DbOrTx = getDb(),
): Promise<CampusContributor[]> {
  if (repos.length === 0) return [];
  const list = sql`array[${sql.join(
    repos.map((repo) => sql`${repo}`),
    sql`, `,
  )}]::citext[]`;
  const rows = await db.execute<{ repo_full_name: string; user_id: string; login: string; merged_prs: number }>(sql`
    select repo_full_name, user_id, login, merged_prs from (
      select c.repo_full_name, c.user_id, gi.login, c.merged_prs,
             row_number() over (partition by c.repo_full_name order by c.merged_prs desc, c.last_merged_at desc nulls last, c.user_id) as place
      from oss_member_contribs c
      join profiles p on p.user_id = c.user_id
      join users u on u.id = c.user_id
      join github_identities gi on gi.user_id = c.user_id
      where c.repo_full_name = any(${list}) and p.university_id = ${universityId} and p.verified_at is not null
        and u.status = 'active' and not p.ghost_mode and p.visibility <> 'hidden' and c.user_id <> ${viewerId}
        and not exists (select 1 from blocks b where (b.blocker = ${viewerId} and b.blocked = c.user_id) or (b.blocker = c.user_id and b.blocked = ${viewerId}))
    ) ranked
    where place <= ${perRepo}
    order by repo_full_name, place`);
  return rows.map((row) => ({ repoFullName: row.repo_full_name, userId: row.user_id, login: row.login, mergedPrs: row.merged_prs }));
}

/** Verified members with a GitHub login, for the weekly refresh. */
export async function verifiedMemberLogins(db: DbOrTx = getDb()): Promise<{ userId: string; login: string }[]> {
  const rows = await db.execute<{ user_id: string; login: string }>(sql`
    select p.user_id, gi.login from profiles p
    join github_identities gi on gi.user_id = p.user_id
    join users u on u.id = p.user_id
    where p.verified_at is not null and u.status = 'active'
    order by p.user_id`);
  return rows.map((row) => ({ userId: row.user_id, login: row.login }));
}
