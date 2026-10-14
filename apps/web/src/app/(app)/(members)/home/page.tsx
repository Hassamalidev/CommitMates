import { campusUnlocks, getUniversity, recentNotifications } from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { campusCopy, homeNotificationsCopy, notificationCopy } from '@/copy/campus';
import { homeCopy } from '@/copy/onboarding';
import { formatUtc } from '@/lib/format';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: homeCopy.meta.title, robots: { index: false } };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * The member's home (CLAUDE.md §9.6): their university and its unlock progress, recent updates and
 * the tools. The today panel (streaks, suggestions, messages, reviews) joins as those features ship.
 */
export default async function HomePage() {
  const member = await getCurrentMember();
  if (!member?.universityId) redirect('/onboarding');
  const [university, progress, notifications] = await Promise.all([
    getUniversity(member.universityId),
    campusUnlocks(member.universityId),
    recentNotifications(member.id),
  ]);
  const copy = homeCopy;
  const open = progress.unlocks.filter((unlock) => unlock.unlocked).length;
  const next = progress.unlocks
    .filter((unlock) => !unlock.unlocked && unlock.metric === 'members')
    .sort((a, b) => a.required - b.required)[0];
  const shown = notifications.flatMap((notification) => {
    const line = notificationCopy[notification.kind];
    return line ? [{ id: notification.id, text: line(isRecord(notification.data) ? notification.data : {}), at: notification.createdAt }] : [];
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
        <Card title={homeNotificationsCopy.title} className="flex flex-col gap-3">
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
