import {
  authEmailOf,
  countUnreadNotifications,
  getNotificationPrefs,
  getSetting,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsEmailed,
  membersDueForDigest,
  notificationsForDigest,
  setNotificationPrefs,
} from '@commitmates/db';
import { MUTABLE_NOTIFICATIONS, describeNotification, type NotificationText } from '@commitmates/email';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

import { deliverEmail } from './email';

type Actor = Pick<Member, 'id'>;

/** Where the digest's "change it in your settings" link goes. */
const SETTINGS_PATH = '/settings/notifications';

export type CenterItem = NotificationText & { id: string; kind: string; read: boolean; createdAt: Date };

/**
 * The notification center (CLAUDE.md §7.5): the member's latest notifications with their words,
 * newest first; kinds this version cannot describe are left out.
 */
export async function getNotificationCenter(member: Actor): Promise<CenterItem[]> {
  const rows = await listNotifications(member.id, await getSetting('notifications.listLimit'));
  return rows.flatMap((row) => {
    const described = describeNotification(row.kind, row.data);
    return described ? [{ ...described, id: row.id, kind: row.kind, read: row.readAt !== null, createdAt: row.createdAt }] : [];
  });
}

/** Unread notifications for the header, leaving out the kinds the member muted. */
export async function unreadNotificationCount(member: Actor): Promise<number> {
  const prefs = await getNotificationPrefs(member.id);
  return countUnreadNotifications(member.id, prefs?.kindsMuted ?? []);
}

export function markAllRead(member: Actor, now: Date = new Date()): Promise<number> {
  return markAllNotificationsRead(member.id, now);
}

/** The member's choices, and which kinds can be muted with their labels. */
export async function getNotificationSettings(member: Actor) {
  const prefs = await getNotificationPrefs(member.id);
  return { emailDigest: prefs?.emailDigest ?? false, kindsMuted: prefs?.kindsMuted ?? [], mutable: MUTABLE_NOTIFICATIONS };
}

const checkbox = z.union([z.boolean(), z.literal('on'), z.literal('')]).transform((value) => value === true || value === 'on');

export const notificationSettingsSchema = z.object({
  emailDigest: checkbox,
  /** Kinds to mute; only kinds that may be muted are kept. */
  muted: z.array(z.string()).transform((kinds) => [...new Set(kinds.filter((kind) => Object.hasOwn(MUTABLE_NOTIFICATIONS, kind)))].sort()),
});

/** Saves the daily digest choice and muted kinds. */
export async function updateNotificationSettings(member: Actor, raw: unknown): Promise<void> {
  const input = notificationSettingsSchema.parse(raw);
  await setNotificationPrefs(member.id, { emailDigest: input.emailDigest, kindsMuted: input.muted });
}

const payloadSchema = z.union([z.object({ userId: z.uuid(), day: z.string() }), z.object({})]);
type DigestPayload = z.infer<typeof payloadSchema>;

/**
 * Daily digests (CLAUDE.md §5.4 `digest_email`, "daily per timezone batch"). The hourly scheduled run
 * finds members whose local hour is `email.digestHourLocal` and queues one digest each, once per local
 * day. A member's digest lists up to `email.digestMaxItems` unread notifications not emailed before,
 * leaving out muted kinds, and goes out within the daily email cap: past it, the job waits until the
 * next UTC day instead of sending.
 */
export const digestEmailJob: JobHandler<DigestPayload> = {
  type: 'digest_email',
  schema: payloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const now = ctx.now();
    if (!('userId' in payload)) {
      const due = await membersDueForDigest(await getSetting('email.digestHourLocal'), now);
      for (const { userId, localDay } of due) {
        await enqueue('digest_email', { userId, day: localDay }, { idempotencyKey: `digest:${userId}:${localDay}`, priority: PRIORITY.USER_BG });
      }
      return { kind: 'done', resultRef: { queued: due.length } };
    }

    const prefs = await getNotificationPrefs(payload.userId);
    if (!prefs?.emailDigest) return { kind: 'done', resultRef: { skipped: 'off' } };
    const rows = await notificationsForDigest(payload.userId, prefs.kindsMuted, await getSetting('email.digestMaxItems'));
    const items = rows.flatMap((row) => {
      const described = describeNotification(row.kind, row.data);
      return described ? [{ id: row.id, item: { title: described.title, line: described.line, path: described.path } }] : [];
    });
    if (items.length === 0) return { kind: 'done', resultRef: { skipped: 'empty' } };
    const to = await authEmailOf(payload.userId);
    if (to === null) return { kind: 'done', resultRef: { skipped: 'no_address' } };
    await deliverEmail('digest', { items: items.map((entry) => entry.item), settingsPath: SETTINGS_PATH }, to, now);
    await markNotificationsEmailed(
      items.map((entry) => entry.id),
      now,
    );
    return { kind: 'done', resultRef: { sent: items.length } };
  },
};
