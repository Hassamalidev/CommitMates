import { randomBytes } from 'node:crypto';

import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { invites, notifications } from '../schema';

/** Random bytes in an invite code (base64url: 12 characters). */
const INVITE_CODE_BYTES = 9;

export type CampusCounts = { members: number; alumni: number };

/** Verified members of a university, and how many of them are alumni (CLAUDE.md §1.4 unlocks). */
export async function campusCounts(universityId: string, db: DbOrTx = getDb()): Promise<CampusCounts> {
  const rows = await db.execute<{ members: number; alumni: number }>(sql`
    select count(*)::int as members, (count(*) filter (where role = 'alumni'))::int as alumni
    from profiles
    where university_id = ${universityId} and verified_at is not null`);
  return { members: rows[0]?.members ?? 0, alumni: rows[0]?.alumni ?? 0 };
}

export type TopicCount = { topic: string; members: number };

/**
 * The most common topics on verified members' own repositories, each member counted once per
 * topic, so one prolific member cannot dominate. Built only from members' public repositories.
 */
export async function campusTopics(universityId: string, limit: number, db: DbOrTx = getDb()): Promise<TopicCount[]> {
  const rows = await db.execute<{ topic: string; members: number }>(sql`
    select topic, count(distinct p.user_id)::int as members
    from profiles p
    join github_identities g on g.user_id = p.user_id
    join gh_repos r on r.owner_github_id = g.github_id and not r.is_fork
    cross join unnest(r.topics) as topic
    where p.university_id = ${universityId} and p.verified_at is not null
    group by topic
    order by members desc, topic
    limit ${limit}`);
  return [...rows];
}

/** The member's invite code for a university, created on first use. */
export async function getOrCreateInvite(universityId: string, userId: string, db: DbOrTx = getDb()): Promise<{ code: string; uses: number }> {
  const code = randomBytes(INVITE_CODE_BYTES).toString('base64url');
  const [created] = await db
    .insert(invites)
    .values({ code, universityId, createdBy: userId })
    .onConflictDoNothing()
    .returning({ code: invites.code, uses: invites.uses });
  if (created) return created;
  const [existing] = await db
    .select({ code: invites.code, uses: invites.uses })
    .from(invites)
    .where(and(eq(invites.universityId, universityId), eq(invites.createdBy, userId)));
  if (!existing) throw new Error('invite was neither created nor found');
  return existing;
}

/**
 * Counts one invitee who verified at the invite's university. Codes for another university and
 * one's own code do not count. Returns whether a use was recorded.
 */
export async function recordInviteUse(code: string, universityId: string, inviteeId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(and(eq(invites.code, code), eq(invites.universityId, universityId), ne(invites.createdBy, inviteeId)))
    .returning({ code: invites.code });
  return rows.length > 0;
}

export type NotificationRow = { id: string; kind: string; data: unknown; readAt: Date | null; createdAt: Date };

/** A member's latest notifications, newest first. */
export async function listRecentNotifications(userId: string, limit: number, db: DbOrTx = getDb()): Promise<NotificationRow[]> {
  return db
    .select({ id: notifications.id, kind: notifications.kind, data: notifications.data, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
