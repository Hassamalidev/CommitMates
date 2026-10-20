import { getNotificationCenter } from '@commitmates/core';
import { Card, Chip, CompanionView, EmptyState } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { notificationsCopy } from '@/copy/notifications';
import { brandCompanion } from '@/lib/brand';
import { formatMessageTime } from '@/lib/chat';
import { markAllReadAction } from '@/server/actions/notifications';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: notificationsCopy.meta.title, robots: { index: false } };
}

/** The notification center (CLAUDE.md §7.5): the member's latest notifications, newest first. */
export default async function NotificationsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/notifications');
  const items = await getNotificationCenter(member);
  const copy = notificationsCopy;
  const unread = items.filter((item) => !item.read).length;

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title}</h1>
        <p className="type-body mt-2 text-fg-muted">{copy.intro}</p>
        <Link href="/settings/notifications" className="type-small mt-2 inline-flex min-h-11 items-center underline">
          {copy.settingsLink}
        </Link>
      </div>
      {unread > 0 ? (
        <ActionForm action={markAllReadAction} submitLabel={copy.markAll} />
      ) : items.length > 0 ? (
        <p role="status" className="type-small text-fg-muted">
          {copy.markedAll}
        </p>
      ) : null}
      {items.length === 0 ? (
        <Card>
          <EmptyState
            companion={<CompanionView companion={brandCompanion} state="idle" size={96} label={copy.title} />}
            title={copy.empty.title}
            description={copy.empty.line}
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.path}
                className={
                  item.read
                    ? 'flex flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:border-line-strong'
                    : 'flex flex-col gap-1 rounded-card border border-accent bg-surface p-4 hover:border-line-strong'
                }
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="type-h3">{item.title}</span>
                  {item.read ? null : <Chip className="font-semibold">{copy.unread}</Chip>}
                </span>
                <span className="type-body break-words">{item.line}</span>
                <time className="type-small text-fg-muted" dateTime={item.createdAt.toISOString()}>
                  {formatMessageTime(item.createdAt.toISOString(), member.timezone)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
