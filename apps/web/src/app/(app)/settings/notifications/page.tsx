import { getNotificationSettings } from '@commitmates/core';
import { Card } from '@commitmates/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { notificationsCopy } from '@/copy/notifications';
import { updateNotificationSettingsAction } from '@/server/actions/notifications';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: notificationsCopy.settings.meta.title, robots: { index: false } };
}

/** Daily digest and muted kinds (CLAUDE.md §7.5 `notification_prefs`). */
export default async function NotificationSettingsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/settings/notifications');
  const settings = await getNotificationSettings(member);
  const copy = notificationsCopy.settings;

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <h1 className="type-h1">{copy.title}</h1>
      <Card>
        <ActionForm
          action={updateNotificationSettingsAction}
          submitLabel={copy.save}
          successMessage={copy.saved}
          variant="primary"
          size="md"
          className="flex flex-col gap-5"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="type-h3 mb-1">{copy.digestTitle}</legend>
            <label className="type-body flex min-h-11 items-center gap-2">
              <input type="checkbox" name="emailDigest" defaultChecked={settings.emailDigest} className="size-4 accent-accent" />
              {copy.digest}
            </label>
            <p className="type-small text-fg-muted">{copy.digestHelp}</p>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="type-h3 mb-1">{copy.mutedTitle}</legend>
            {Object.entries(settings.mutable).map(([kind, label]) => (
              <label key={kind} className="type-body flex min-h-11 items-center gap-2">
                <input type="checkbox" name="muted" value={kind} defaultChecked={settings.kindsMuted.includes(kind)} className="size-4 accent-accent" />
                {copy.muteLabel(label)}
              </label>
            ))}
            <p className="type-small text-fg-muted">{copy.mutedHelp}</p>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
