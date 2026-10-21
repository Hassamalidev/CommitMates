import {
  canViewProfile,
  canVouchFor,
  getProfileExtras,
  getProfileOwner,
  getSetting,
  getVouchingStatus,
  hasVouched,
  isBlocking,
  isPublicProfile,
  profileViewerFor,
  type ProfileExtras,
} from '@commitmates/core';
import { Card, Chip } from '@commitmates/ui';
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
import { profileCopy } from '@/copy/profile';
import { reviewsCopy } from '@/copy/reviews';
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
  // `country` visibility compares the countries of the two members' universities.
  const viewer = member ? await profileViewerFor(member) : null;
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

/** Badges, revived projects and showcased projects (CLAUDE.md §8 F1, P5-T10), for anyone who may see the page. */
function MemberExtras({ extras, viewerUniversityId }: { extras: ProfileExtras; viewerUniversityId: string | null }) {
  const copy = profileCopy;
  const { badges, showcase } = extras;
  const earned: { key: string; name: string; line: string }[] = [
    ...(badges.reviewer
      ? [{ key: 'reviewer', name: copy.badges.reviewer.name, line: copy.badges.reviewer.line(reviewsCopy.reputation.tiers[badges.reviewer.tier] ?? '', badges.reviewer.helpful) }]
      : []),
    ...(badges.reviver ? [{ key: 'reviver', name: copy.badges.reviver.name, line: copy.badges.reviver.line(badges.reviver.length) }] : []),
    ...(badges.streak ? [{ key: 'streak', name: copy.badges.streak.name, line: copy.badges.streak.line(badges.streak.longest) }] : []),
    ...(badges.oss ? [{ key: 'oss', name: copy.badges.oss.name, line: copy.badges.oss.line(badges.oss.mergedPrs, badges.oss.projects) }] : []),
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={copy.badges.title} titleAs="h2" className="flex flex-col gap-2" data-testid="profile-badges">
        {earned.length === 0 ? (
          <p className="type-small text-fg-muted">{copy.badges.none}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {earned.map((badge) => (
              <li key={badge.key} className="type-small flex flex-wrap items-center gap-2">
                <Chip>{badge.name}</Chip>
                <span>{badge.line}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {badges.reviver ? (
        <Card title={copy.revived.title} titleAs="h2" className="flex flex-col gap-2">
          <ul className="type-small flex flex-col gap-1">
            {badges.reviver.map((project, index) => (
              <li key={`${project.fullName ?? 'unknown'}-${index}`}>
                <span className="font-semibold break-words">{project.fullName ?? copy.revived.unknown}</span> · {copy.revived[project.role]}
                {project.forkFullName ? `, ${copy.revived.fork(project.forkFullName)}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {showcase.length > 0 ? (
        <Card title={copy.showcase.title} titleAs="h2" className="flex flex-col gap-2 md:col-span-2">
          <ul className="flex flex-col gap-2">
            {showcase.map((entry) => (
              <li key={entry.id} className="type-small flex flex-col gap-0.5">
                {entry.universityId === viewerUniversityId ? (
                  <a href={`/legacy/${entry.id}`} className="font-semibold break-words text-accent underline underline-offset-4" aria-label={copy.showcase.open(entry.fullName)}>
                    {entry.fullName}
                  </a>
                ) : (
                  <a href={`https://github.com/${entry.fullName}`} rel="noopener noreferrer" className="font-semibold break-words text-accent underline underline-offset-4">
                    {entry.fullName}
                  </a>
                )}
                {entry.blurb ?? entry.description ? <span className="break-words text-fg-muted">{entry.blurb ?? entry.description}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
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
        <MemberExtras extras={await getProfileExtras(owner)} viewerUniversityId={viewer?.universityId ?? null} />
        <DevCardTool initialLogin={owner.login} fixed />
      </div>
    </SiteFrame>
  );
}
