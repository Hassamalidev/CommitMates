import { canViewProfile, getProfileOwner, isPublicProfile } from '@commitmates/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { DevCardTool } from '@/components/dev-card/DevCardTool';
import { SiteFrame } from '@/components/layout/SiteFrame';
import { devCardCopy } from '@/copy/dev-card';
import { getCurrentMember } from '@/server/auth';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ login: string }> };

/**
 * The member behind this address, if the visitor may see their page. People who have not
 * signed up have no page at all, and a page the visitor may not see looks the same as
 * one that does not exist (CLAUDE.md §2.6).
 */
const loadProfile = cache(async (login: string) => {
  const owner = await getProfileOwner(decodeURIComponent(login));
  if (!owner) return null;
  const member = await getCurrentMember();
  const viewer = member ? { id: member.id, universityId: member.universityId, verified: member.verified } : null;
  return canViewProfile(owner, viewer) ? { owner, isSelf: member?.id === owner.userId } : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await loadProfile((await params).login);
  if (!profile) return { robots: { index: false, follow: false } };
  return {
    title: devCardCopy.meta.profileTitle(profile.owner.login),
    description: devCardCopy.meta.profileDescription(profile.owner.login),
    // Only a profile its owner made public may be indexed.
    robots: isPublicProfile(profile.owner) ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function MemberProfilePage({ params }: Props) {
  const profile = await loadProfile((await params).login);
  if (!profile) notFound();
  const { owner, isSelf } = profile;

  return (
    <SiteFrame>
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10 sm:py-14">
        <header>
          <p className="type-eyebrow text-fg-muted">{devCardCopy.profile.eyebrow}</p>
          <h1 className="type-h1 mt-1 break-words">{devCardCopy.meta.profileTitle(owner.login)}</h1>
          {isSelf && owner.visibility === 'hidden' ? (
            <p className="type-small mt-2 text-fg-muted">{devCardCopy.profile.hiddenFromOthers}</p>
          ) : null}
        </header>
        <DevCardTool initialLogin={owner.login} fixed />
      </div>
    </SiteFrame>
  );
}
