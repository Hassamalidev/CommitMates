import { getUniversity } from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { homeCopy } from '@/copy/onboarding';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: homeCopy.meta.title, robots: { index: false } };
}

/** The member's home (CLAUDE.md §9.6). The today panel and university card grow with each phase. */
export default async function HomePage() {
  const member = await getCurrentMember();
  if (!member?.universityId) redirect('/onboarding');
  const university = await getUniversity(member.universityId);
  const copy = homeCopy;

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title(member.login)}</h1>
        {university ? (
          <p className="type-body mt-2 text-fg-muted">
            {copy.verifiedAt(university.name)} {copy.members(university.memberCount)}
          </p>
        ) : null}
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
