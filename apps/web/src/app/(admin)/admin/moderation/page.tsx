import { moderationScope } from '@commitmates/core';
import { Card, EmptyState } from '@commitmates/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { adminCopy } from '@/copy/admin';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: adminCopy.moderation.metaTitle, robots: { index: false } };
}

/**
 * The moderation queue (CLAUDE.md §8 F12 "Moderation queue", §5.11): admins see everything,
 * moderators only what concerns members of their universities. Reports arrive with chat (P4-T06).
 */
export default async function AdminModerationPage() {
  const member = await getCurrentMember();
  if (!member) notFound();
  const scope = await moderationScope(member).catch(() => null);
  if (!scope) notFound();
  const copy = adminCopy.moderation;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">
        {scope.admin ? copy.scopeAdmin : copy.scopeModerator(scope.universities.map((university) => university.name).join(', '))}
      </p>
      <Card title={copy.queueTitle} className="mt-6">
        <EmptyState title={copy.queueTitle} description={copy.queueEmpty} />
      </Card>
    </>
  );
}
