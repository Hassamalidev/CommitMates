import { getDiscover, getOnboardingOptions, getUniversity, inviteFor, parseDiscoverQuery } from '@commitmates/core';
import { Card, CompanionView, EmptyState, Input, Skeleton, UnlockCard, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { InviteButton } from '@/components/campus/InviteButton';
import { DevelopersLikeYou } from '@/components/discover/DevelopersLikeYou';
import { DeckFilters, ModeTabs } from '@/components/discover/DiscoverControls';
import { DiscoverDeck } from '@/components/discover/DiscoverDeck';
import { ActionForm } from '@/components/forms/ActionForm';
import { campusCopy } from '@/copy/campus';
import { discoverCopy } from '@/copy/discover';
import { brandCompanion } from '@/lib/brand';
import { discoverHref, toCardView } from '@/lib/discover';
import { siteUrl } from '@/lib/site';
import { saveLearningGoalsAction } from '@/server/actions/discover';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: discoverCopy.meta.title, robots: { index: false } };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Goal tags offered as examples in the empty-profile prompt. */
const GOAL_EXAMPLES = 12;

function SimilarFallback() {
  return (
    <Card title={discoverCopy.similar.title} titleAs="h2" className="flex flex-col gap-3" aria-busy="true">
      <p className="type-small text-fg-muted">{discoverCopy.similar.loading}</p>
      <Skeleton className="h-24" />
    </Card>
  );
}

/**
 * Discover (CLAUDE.md §8 F11 "UI"): today's deck per mode with filters and actions, or, before
 * matching opens at the university, its Unlock card and view-only developers like the member.
 */
export default async function DiscoverPage({ searchParams }: Props) {
  const member = await getCurrentMember();
  if (!member?.universityId) redirect('/onboarding');
  const now = new Date();
  const view = await getDiscover(member, parseDiscoverQuery(await searchParams), now);
  const copy = discoverCopy;
  const idle = <CompanionView companion={brandCompanion} state="idle" size={96} label={campusCopy.unlocks.matching.title} />;

  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
      <Link href="/inbox" className="type-small mt-2 inline-flex min-h-11 items-center underline">
        {copy.inboxLink}
      </Link>
    </header>
  );

  if (view.status === 'locked') {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.matching.title}
          description={copy.locked.line}
          current={view.unlock.current}
          required={view.unlock.required}
          progressLabel={campusCopy.progress.members(view.unlock.current, view.unlock.required)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
        <Suspense fallback={<SimilarFallback />}>
          <DevelopersLikeYou member={member} />
        </Suspense>
      </div>
    );
  }

  const filtersActive = [view.filters.departmentId, view.filters.yearFrom, view.filters.yearTo, view.filters.tag].some((value) => value !== undefined);
  const empty = !view.hasDeck ? (
    <EmptyState companion={idle} title={copy.empty.firstDeck.title} description={copy.empty.firstDeck.line} />
  ) : filtersActive ? (
    <EmptyState
      companion={idle}
      title={copy.empty.filtered.title}
      description={copy.empty.filtered.line}
      action={
        <Link href={discoverHref(view.mode)} className={buttonStyles({ variant: 'secondary', size: 'md' })}>
          {copy.filters.clear}
        </Link>
      }
    />
  ) : (
    <EmptyState companion={idle} title={copy.empty.seenEveryone.title} description={copy.empty.seenEveryone.line} />
  );
  const examples = view.emptyProfile && !view.hasGoals ? (await getOnboardingOptions(member)).suggestions.slice(0, GOAL_EXAMPLES) : [];

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      {view.emptyProfile && !view.hasGoals ? (
        <Card title={copy.emptyProfile.title} titleAs="h2" className="flex max-w-reading flex-col gap-3">
          <p className="type-body text-fg-muted">{copy.emptyProfile.line}</p>
          <ActionForm action={saveLearningGoalsAction} submitLabel={copy.emptyProfile.submit} successMessage={copy.emptyProfile.saved} className="flex flex-col items-start gap-2">
            <Input
              label={copy.emptyProfile.label}
              name="learningGoals"
              description={examples.length > 0 ? copy.emptyProfile.helpWithExamples(examples) : copy.emptyProfile.help}
              className="w-full"
            />
          </ActionForm>
        </Card>
      ) : null}
      <ModeTabs mode={view.mode} filters={view.filters} />
      <DiscoverDeck
        cards={view.cards.map((card) => toCardView(card, view.hasGoals, member.timezone, now))}
        liked={view.liked.map((card) => toCardView(card, view.hasGoals, member.timezone, now))}
        firstMessage={view.firstMessage}
        empty={empty}
        aside={<DeckFilters view={view} />}
      />
      {view.hasDeck ? null : (
        <Suspense fallback={<SimilarFallback />}>
          <DevelopersLikeYou member={member} />
        </Suspense>
      )}
    </div>
  );
}
