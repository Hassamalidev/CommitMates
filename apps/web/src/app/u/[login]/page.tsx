import { canViewProfile, canVouchFor, getProfileOwner, getSetting, getVouchingStatus, hasVouched, isBlocking, isPublicProfile } from '@commitmates/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { DevCardTool } from '@/components/dev-card/DevCardTool';
import { ActionForm } from '@/components/forms/ActionForm';
import { SiteFrame } from '@/components/layout/SiteFrame';
import { SafetyActions } from '@/components/safety/SafetyActions';
import { ShareButton } from '@/components/share/ShareButton';
import { devCardCopy } from '@/copy/dev-card';
import { vouchCopy } from '@/copy/onboarding';
import { shareCopy } from '@/copy/share';
import { siteName, siteUrl } from '@/lib/site';
import { vouchAction } from '@/server/actions/verification';
import { getCurrentMember } from '@/server/auth';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ login: string }> };

const ogImagePath = (login: string) => `/api/og/dev-card?login=${encodeURIComponent(login)}`;

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
  const shareable = isPublicProfile(profile.owner);
  const login = profile.owner.login;
  return {
    title: devCardCopy.meta.profileTitle(profile.owner.login),
    description: devCardCopy.meta.profileDescription(profile.owner.login),
    // Only a profile its owner made public may be indexed.
    robots: shareable ? { index: true, follow: true } : { index: false, follow: false },
    // A share image exists only for a public profile (CLAUDE.md §9.7).
    ...(shareable
      ? {
          openGraph: {
            title: shareCopy.title(login, siteName),
            images: [{ url: ogImagePath(login), width: 1200, height: 630, alt: shareCopy.imageAlt(login) }],
          },
          twitter: { card: 'summary_large_image', images: [ogImagePath(login)] },
        }
      : {}),
  };
}

export default async function MemberProfilePage({ params }: Props) {
  const profile = await loadProfile((await params).login);
  if (!profile) notFound();
  const { owner, isSelf } = profile;
  // Verified members of the university this member chose may vouch for them (CLAUDE.md §8 F10 step 5).
  const viewer = await getCurrentMember();
  const vouching = viewer && (await canVouchFor(viewer.id, owner.userId)) ? await getVouchingStatus(owner.userId) : null;
  // After vouching the button goes away; say so instead of leaving nothing.
  const vouched = viewer && !isSelf ? await hasVouched(viewer.id, owner.userId) : false;
  // Verified members can block or report another member from their page (CLAUDE.md §8 F12).
  const safety =
    viewer?.verified && viewer.status !== 'suspended' && !isSelf
      ? { blocked: await isBlocking(viewer, owner.userId), detailsMax: await getSetting('safety.reportDetailsMaxChars') }
      : null;

  return (
    <SiteFrame>
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10 sm:py-14">
        <header>
          <p className="type-eyebrow text-fg-muted">{devCardCopy.profile.eyebrow}</p>
          <h1 className="type-h1 mt-1 break-words">{devCardCopy.meta.profileTitle(owner.login)}</h1>
          {isPublicProfile(owner) ? (
            <div className="mt-3">
              <ShareButton url={`${siteUrl}/u/${encodeURIComponent(owner.login)}`} title={shareCopy.title(owner.login, siteName)} />
            </div>
          ) : null}
          {safety ? (
            <div className="mt-3">
              <SafetyActions userId={owner.userId} login={owner.login} blocked={safety.blocked} detailsMax={safety.detailsMax} />
            </div>
          ) : null}
          {isSelf && owner.visibility === 'hidden' ? (
            <p className="type-small mt-2 text-fg-muted">{devCardCopy.profile.hiddenFromOthers}</p>
          ) : null}
        </header>
        {vouching ? (
          <section aria-label={vouchCopy.button(owner.login)} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <p className="type-body">{vouchCopy.waiting(owner.login, vouching.universityName)}</p>
            <p className="type-small text-fg-muted">{vouchCopy.hint}</p>
            <ActionForm
              action={vouchAction}
              values={{ login: owner.login }}
              submitLabel={vouchCopy.button(owner.login)}
              successMessage={vouchCopy.done}
              variant="primary"
              size="md"
            />
          </section>
        ) : null}
        {vouched ? (
          <p role="status" className="type-body rounded-card border border-line bg-surface p-4">
            {vouchCopy.done}
          </p>
        ) : null}
        <DevCardTool initialLogin={owner.login} fixed />
      </div>
    </SiteFrame>
  );
}
