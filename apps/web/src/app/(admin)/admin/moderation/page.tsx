import { getModerationQueue, getSetting, hasRole } from '@commitmates/core';
import { Card, EmptyState } from '@commitmates/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReportGroupCard } from '@/components/admin/ReportGroupCard';
import { adminCopy } from '@/copy/admin';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: adminCopy.moderation.metaTitle, robots: { index: false } };
}

/**
 * The moderation queue (CLAUDE.md §8 F12 "Moderation queue", §5.11): open reports grouped by the
 * reported member; admins see everything, moderators only members of their universities.
 */
export default async function AdminModerationPage() {
  const member = await getCurrentMember();
  if (member?.status !== 'active') notFound();
  const queue = await getModerationQueue(member).catch(() => null);
  if (!queue) notFound();
  const maxDays = await getSetting('safety.maxSuspensionDays');
  const copy = adminCopy.moderation;
  const { scope, groups } = queue;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">
        {scope.admin ? copy.scopeAdmin : copy.scopeModerator(scope.universities.map((university) => university.name).join(', '))} {copy.intro}
      </p>
      <section aria-labelledby="queue-title" className="mt-6 flex flex-col gap-4">
        <h2 id="queue-title" className="type-h2">
          {copy.queueTitle}
        </h2>
        {groups.length === 0 ? (
          <Card>
            <EmptyState title={copy.queueTitle} description={copy.queueEmpty} />
          </Card>
        ) : (
          groups.map((group) => (
            <ReportGroupCard
              key={group.targetUserId}
              maxDays={maxDays}
              canActOnAdmins={hasRole(member, 'admin')}
              group={{
                targetUserId: group.targetUserId,
                login: group.login,
                name: group.name,
                status: group.status,
                universityName: group.universityName,
                isAdmin: group.isAdmin,
                reports: group.reports.map((report) => ({
                  id: report.id,
                  reason: report.reason,
                  details: report.details,
                  reporterLogin: report.reporterLogin,
                  hasMessage: report.targetMessage !== null,
                  createdAt: report.createdAt.toISOString(),
                })),
              }}
            />
          ))
        )}
      </section>
    </>
  );
}
