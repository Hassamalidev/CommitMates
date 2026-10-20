import { and, count, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { notificationPrefs, notifications } from '../schema';

export type NotificationItem = { id: string; kind: string; data: unknown; readAt: Date | null; createdAt: Date };

/** A member's latest notifications, newest first. */
export async function listNotifications(userId: string, limit: number, db: DbOrTx = getDb()): Promise<NotificationItem[]> {
  return db
    .select({ id: notifications.id, kind: notifications.kind, data: notifications.data, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

/** Marks every unread notification of a member read. */
export async function markAllNotificationsRead(userId: string, now: Date, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Unread notifications of a member, leaving out the kinds they muted. */
export async function countUnreadNotifications(userId: string, mutedKinds: readonly string[], db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        mutedKinds.length > 0 ? notInArray(notifications.kind, [...mutedKinds]) : undefined,
      ),
    );
  return row?.unread ?? 0;
}

export type NotificationPrefs = { emailDigest: boolean; kindsMuted: string[] };

/** A member's notification preferences; null before they first chose any. */
export async function getNotificationPrefs(userId: string, db: DbOrTx = getDb()): Promise<NotificationPrefs | null> {
  const [row] = await db
    .select({ emailDigest: notificationPrefs.emailDigest, kindsMuted: notificationPrefs.kindsMuted })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId));
  return row ?? null;
}

export async function setNotificationPrefs(userId: string, prefs: NotificationPrefs, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: prefs });
}

/**
 * Members whose local clock reads `hour` now, who want email digests, are active, and have unread
 * notifications not emailed yet in kinds they did not mute; with their local date (CLAUDE.md §5.4
 * `digest_email`, "daily per timezone batch"). Timezones Postgres does not know are skipped.
 */
export async function membersDueForDigest(hour: number, now: Date, db: DbOrTx = getDb()): Promise<{ userId: string; localDay: string }[]> {
  const at = now.toISOString();
  const rows = await db.execute<{ user_id: string; local_day: string }>(sql`
    select p.user_id, to_char(${at}::timestamptz at time zone p.timezone, 'YYYY-MM-DD') as local_day
    from profiles p
    join notification_prefs np on np.user_id = p.user_id
    join users u on u.id = p.user_id
    where np.email_digest and u.status = 'active'
      and p.timezone in (select name from pg_timezone_names)
      and extract(hour from ${at}::timestamptz at time zone p.timezone) = ${hour}
      and exists (
        select 1 from notifications n
        where n.user_id = p.user_id and n.read_at is null and n.emailed_at is null and not (n.kind = any(np.kinds_muted)))
    order by p.user_id`);
  return rows.map((row) => ({ userId: row.user_id, localDay: row.local_day }));
}

/** Unread notifications not emailed yet, in kinds the member did not mute, oldest first. */
export async function notificationsForDigest(userId: string, mutedKinds: readonly string[], limit: number, db: DbOrTx = getDb()): Promise<NotificationItem[]> {
  return db
    .select({ id: notifications.id, kind: notifications.kind, data: notifications.data, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.emailedAt),
        mutedKinds.length > 0 ? notInArray(notifications.kind, [...mutedKinds]) : undefined,
      ),
    )
    .orderBy(notifications.createdAt, notifications.id)
    .limit(limit);
}

/** Records that notifications went out in a digest, so the next one does not repeat them. */
export async function markNotificationsEmailed(ids: readonly string[], now: Date, db: DbOrTx = getDb()): Promise<void> {
  if (ids.length === 0) return;
  await db.update(notifications).set({ emailedAt: now }).where(inArray(notifications.id, [...ids]));
}
