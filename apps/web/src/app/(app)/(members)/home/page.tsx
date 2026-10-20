import { campusUnlocks, describeNotification, getUniversity, recentNotifications, unreadCount } from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { campusCopy, homeNotificationsCopy } from '@/copy/campus';
import { chatCopy } from '@/copy/chat';
import { notificationsCopy } from '@/copy/notifications';
import { homeCopy } from '@/copy/onboarding';
import { formatUtc } from '@/lib/format';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: homeCopy.meta.title, robots: { index: false } };
}

/**
 * The member's home (CLAUDE.md §9.6): their university and its unlock progress, recent updates and
 * Discover, and the tools. The today panel (streaks, suggestions, messages, reviews) joins as those features ship.
 */
export default async function HomePage() {
  const member = await getCurrentMember();
  if (!member?.universityId) redirect('/onboarding');
  const [university, progress, notifications, unread] = await Promise.all([
    getUniversity(member.universityId),
    campusUnlocks(member.universityId),
    recentNotifications(member.id),
    unreadCount(member),
  ]);
  const copy = homeCopy;
  const open = progress.unlocks.filter((unlock) => unlock.unlocked).length;
  const matching = progress.unlocks.find((unlock) => unlock.key === 'matching');
  const next = progress.unlocks
    .filter((unlock) => !unlock.unlocked && unlock.metric === 'members')
    .sort((a, b) => a.required - b.required)[0];
  const shown = notifications.flatMap((notification) => {
    const described = describeNotification(notification.kind, notification.data);
    return described ? [{ id: notification.id, text: described.line, at: notification.createdAt }] : [];
  });

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title(member.login)}</h1>
        {university ? (
          <p className="type-body mt-2 text-fg-muted">
            {copy.verifiedAt(university.name)} {copy.members(progress.members)}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {university ? (
          <Card title={copy.universityTitle} className="flex flex-col gap-3">
            <p className="type-body">{copy.openFeatures(open, progress.unlocks.length)}</p>
            {next ? (
              <p className="type-small text-fg-muted">{copy.nextUnlock(campusCopy.unlocks[next.key].title, next.current, next.required)}</p>
            ) : null}
            <Link href={`/uni/${university.slug}`} className={buttonStyles({ variant: 'secondary', size: 'md', className: 'self-start' })}>
              {copy.universityLink}
            </Link>
          </Card>
        ) : null}
        {matching ? (
          <Card title={copy.discoverTitle} className="flex flex-col gap-3">
            <p className="type-body">{matching.unlocked ? copy.discoverOpen : copy.discoverLocked(matching.current, matching.required)}</p>
            <Link href="/discover" className={buttonStyles({ variant: matching.unlocked ? 'primary' : 'secondary', size: 'md', className: 'self-start' })}>
              {copy.discoverLink}
            </Link>
          </Card>
        ) : null}
        <Card title={chatCopy.home.title} className="flex flex-col gap-3">
          <p className="type-body">{chatCopy.home.unread(unread)}</p>
          <Link href="/inbox" className={buttonStyles({ variant: unread > 0 ? 'primary' : 'secondary', size: 'md', className: 'self-start' })}>
            {chatCopy.home.link}
          </Link>
        </Card>
        <Card title={homeNotificationsCopy.title} className="flex flex-col gap-3">
          <Link href="/notifications" className="type-small self-start underline">
            {notificationsCopy.homeLink}
          </Link>
          {shown.length === 0 ? (
            <p className="type-small text-fg-muted">{homeNotificationsCopy.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((item) => (
                <li key={item.id} className="type-small">
                  <span>{item.text}</span> <span className="text-fg-muted">{formatUtc(item.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title={copy.toolsTitle} className="flex max-w-reading flex-col gap-3">
        <p className="type-body text-fg-muted">{copy.toolsLine}</p>
        <Link href="/#tools" className={buttonStyles({ variant: 'secondary', size: 'md', className: 'self-start' })}>
          {copy.toolsLink}
        </Link>
      </Card>
    </div>
  );
}
