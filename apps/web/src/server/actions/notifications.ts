'use server';

import { markAllRead, unreadNotificationCount, updateNotificationSettings } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

/** Unread notifications for the header badge (muted kinds left out). */
export async function notificationBadgeAction(): Promise<ActionResult<number>> {
  return withAction('notifications.badge', async (): Promise<number> => unreadNotificationCount(await requireUser()))();
}

/** Marks every notification read (CLAUDE.md §7.5). */
export const markAllReadAction = async (_previous: ActionResult<null> | null) =>
  withAction('notifications.markAll', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await markAllRead(member);
    revalidatePath('/notifications');
    revalidatePath('/home');
    return null;
  })();

/** Saves the daily digest choice and the muted kinds. */
export const updateNotificationSettingsAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('notifications.settings', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    const digest = formData.get('emailDigest');
    await updateNotificationSettings(member, {
      emailDigest: typeof digest === 'string' ? digest : '',
      muted: formData.getAll('muted').filter((value): value is string => typeof value === 'string'),
    });
    revalidatePath('/settings/notifications');
    return null;
  })();
