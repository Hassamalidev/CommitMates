import { claimDeadline, getReviewsOverview, getUniversity, inviteFor, reviewReputation, reviewsAccess, type ReviewsOverview } from '@commitmates/core';
import { Card, Chip, EmptyState, Input, StateChip, Tabs, Textarea, UnlockCard } from '@commitmates/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { ActionForm } from '@/components/forms/ActionForm';
import { campusCopy } from '@/copy/campus';
import { reviewsCopy } from '@/copy/reviews';
import { formatUtc } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import {
  claimRequestAction,
  createReviewRequestAction,
  disputeRatingAction,
  markSubmittedAction,
  rateReviewAction,
  unclaimRequestAction,
  withdrawReviewRequestAction,
} from '@/server/actions/reviews';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: reviewsCopy.meta.title, robots: { index: false } };
}

type Request = ReviewsOverview['mine'][number];

const STATUS_STATE = {
  open: 'waiting',
  claimed: 'working',
  submitted: 'waiting',
  settled_helpful: 'done',
  settled_unhelpful: 'idle',
  expired: 'idle',
  disputed: 'waiting',
} as const;

const TABS = ['open', 'mine', 'claimed'] as const;
type Tab = (typeof TABS)[number];

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

const utc = (date: Date) => `${formatUtc(date) ?? ''} UTC`;
const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

function PullTitle({ request }: { request: Request }) {
  const name = reviewsCopy.pr(request.repoFullName, request.prNumber);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <a href={request.prUrl} rel="noopener noreferrer" target="_blank" className="type-body font-semibold break-all underline">
        {name}
      </a>
      {request.languages.map((language) => (
        <Chip key={language}>{language}</Chip>
      ))}
    </span>
  );
}

/**
 * The Review Exchange (CLAUDE.md §8 F15, §9.6): open requests to claim, the member's own requests
 * and the reviews they are writing, with their credits and reputation alongside.
 */
export default async function ReviewsPage({ searchParams }: Props) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/reviews');
  const copy = reviewsCopy;
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
    </header>
  );

  const access = await reviewsAccess(member);
  if (access.state !== 'open' || member.universityId === null) {
    if (member.universityId === null) redirect('/onboarding');
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    const progress = access.state === 'locked' ? access : { current: 0, required: 0 };
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.reviews.title}
          description={copy.locked}
          current={progress.current}
          required={progress.required}
          progressLabel={campusCopy.progress.members(progress.current, progress.required)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
      </div>
    );
  }

  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.find((value) => value === (Array.isArray(tabParam) ? tabParam[0] : tabParam)) ?? 'open';
  const [overview, reputation] = await Promise.all([getReviewsOverview(member), reviewReputation(member.id, member.universityId)]);
  const { credits, claimable, mine, claimed, rules } = overview;
  const renderedAt = new Date().getTime();

  const openPanel =
    claimable.length === 0 ? (
      <Card>
        <EmptyState title={copy.tabs.open} description={copy.open.empty} />
      </Card>
    ) : (
      <ul className="flex flex-col gap-3" aria-label={copy.tabs.open}>
        {claimable.map((request) => {
          const name = copy.pr(request.repoFullName, request.prNumber);
          return (
            <li key={request.id}>
              <Card as="article" aria-label={name} className="flex flex-col gap-2">
                <PullTitle request={request} />
                <p className="type-small text-fg-muted">
                  {copy.open.by(request.authorLogin)} · {copy.open.until(utc(request.expiresAt))}
                </p>
                <ActionForm action={claimRequestAction} values={{ requestId: request.id }} submitLabel={copy.open.claimLabel(name)} variant="primary" />
              </Card>
            </li>
          );
        })}
      </ul>
    );

  const minePanel =
    mine.length === 0 ? (
      <Card>
        <EmptyState title={copy.tabs.mine} description={copy.mine.empty} />
      </Card>
    ) : (
      <ul className="flex flex-col gap-3" aria-label={copy.tabs.mine}>
        {mine.map((request) => {
          const name = copy.pr(request.repoFullName, request.prNumber);
          return (
            <li key={request.id}>
              <Card as="article" aria-label={name} className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <PullTitle request={request} />
                  <StateChip state={STATUS_STATE[request.status]} label={copy.status[request.status]} />
                </span>
                {request.status === 'open' ? (
                  <>
                    <p className="type-small text-fg-muted">{copy.open.until(utc(request.expiresAt))}</p>
                    <ActionForm action={withdrawReviewRequestAction} values={{ requestId: request.id }} submitLabel={copy.mine.withdrawLabel(name)} variant="ghost" />
                  </>
                ) : null}
                {request.status === 'claimed' ? <p className="type-small">{copy.mine.claimedBy(request.claimerLogin)}</p> : null}
                {request.review ? <p className="type-small">{copy.mine.reviewedBy(request.claimerLogin, request.review.lineComments)}</p> : null}
                {request.status === 'submitted' ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="type-small font-semibold">{copy.mine.rateLegend(name)}</legend>
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={rateReviewAction} values={{ requestId: request.id, rating: 'helpful' }} submitLabel={copy.mine.helpfulLabel(name)} variant="primary" />
                      <ActionForm action={rateReviewAction} values={{ requestId: request.id, rating: 'unhelpful' }} submitLabel={copy.mine.unhelpfulLabel(name)} />
                    </div>
                    <p className="type-small text-fg-muted">{copy.mine.autoSettle(rules.autoSettleDays)}</p>
                  </fieldset>
                ) : null}
                {request.status === 'expired' ? <p className="type-small text-fg-muted">{copy.mine.ended}</p> : null}
              </Card>
            </li>
          );
        })}
      </ul>
    );

  const claimedPanel =
    claimed.length === 0 ? (
      <Card>
        <EmptyState title={copy.tabs.claimed} description={copy.claimed.empty} />
      </Card>
    ) : (
      <ul className="flex flex-col gap-3" aria-label={copy.tabs.claimed}>
        {claimed.map((request) => {
          const name = copy.pr(request.repoFullName, request.prNumber);
          const mineNow = request.claimedBy === member.id;
          const ratedAt = request.review?.ratedAt;
          // The reviewer may dispute an unhelpful rating for `reviews.disputeWindowDays` (§8 F15).
          const canDispute = request.status === 'settled_unhelpful' && ratedAt !== undefined && ratedAt !== null && ratedAt.getTime() + rules.disputeWindowDays * MS_PER_DAY > renderedAt;
          return (
            <li key={request.id}>
              <Card as="article" aria-label={name} className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <PullTitle request={request} />
                  <StateChip state={STATUS_STATE[request.status]} label={copy.status[request.status]} />
                </span>
                {request.status === 'claimed' && mineNow && request.claimedAt ? (
                  <>
                    <p className="type-small">{copy.claimed.until(utc(claimDeadline(request.claimedAt, rules.claimTtlHours)))}</p>
                    <p className="type-small text-fg-muted">{copy.rules(rules.minLineComments, rules.claimTtlHours)}</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={markSubmittedAction} values={{ requestId: request.id }} submitLabel={copy.claimed.submitLabel(name)} successMessage={copy.claimed.checking} variant="primary" />
                      <ActionForm action={unclaimRequestAction} values={{ requestId: request.id }} submitLabel={copy.claimed.giveBackLabel(name)} variant="ghost" />
                    </div>
                  </>
                ) : null}
                {request.status === 'submitted' ? <p className="type-small">{copy.claimed.waiting}</p> : null}
                {request.status === 'settled_helpful' ? <p className="type-small text-state-done">{copy.claimed.earned}</p> : null}
                {request.status === 'disputed' ? <p className="type-small">{copy.claimed.disputed}</p> : null}
                {request.status === 'settled_unhelpful' ? <p className="type-small">{copy.claimed.unhelpful}</p> : null}
                {canDispute ? (
                  <>
                    <ActionForm action={disputeRatingAction} values={{ requestId: request.id }} submitLabel={copy.claimed.disputeLabel(name)} className="flex flex-col items-start gap-2">
                      <Textarea
                        label={copy.claimed.disputeNote}
                        name="note"
                        rows={3}
                        required
                        maxLength={rules.disputeNoteMaxChars}
                        description={copy.claimed.disputeHelp(rules.disputeNoteMaxChars)}
                      />
                    </ActionForm>
                  </>
                ) : null}
                {request.status === 'expired' || (request.status === 'open' && !mineNow) ? <p className="type-small text-fg-muted">{copy.claimed.ended}</p> : null}
              </Card>
            </li>
          );
        })}
      </ul>
    );

  const tierName = reputation.helpful > 0 ? copy.reputation.tiers[reputation.tier] : undefined;

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs
          label={copy.tabs.label}
          defaultValue={tab}
          items={[
            { value: 'open', label: copy.tabs.open, content: openPanel },
            { value: 'mine', label: copy.tabs.mine, content: minePanel },
            { value: 'claimed', label: copy.tabs.claimed, content: claimedPanel },
          ]}
        />
        <aside className="flex flex-col gap-4" aria-label={copy.balance.title}>
          <Card title={copy.balance.title} titleAs="h2" className="flex flex-col gap-2">
            <p className="type-h2" data-testid="credit-balance">
              {copy.balance.value(credits.balance)}
            </p>
            {credits.history.length > 0 ? (
              <>
                <h3 className="type-small font-semibold">{copy.balance.history}</h3>
                <ul className="type-small flex flex-col gap-1">
                  {credits.history.map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-2">
                      <span>{copy.balance.reasons[entry.reason] ?? entry.reason}</span>
                      <span className="font-mono">{copy.balance.delta(entry.delta)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
          <Card title={copy.reputation.title} titleAs="h2" className="flex flex-col gap-1">
            {reputation.helpful === 0 ? (
              <p className="type-small text-fg-muted">{copy.reputation.none}</p>
            ) : (
              <>
                <p className="type-body font-semibold">{tierName}</p>
                <p className="type-small">{copy.reputation.value(reputation.helpful)}</p>
                {reputation.percentile !== null ? <p className="type-small text-fg-muted">{copy.reputation.percentile(reputation.percentile)}</p> : null}
              </>
            )}
          </Card>
          <Card title={copy.ask.title} titleAs="h2" className="flex flex-col gap-2">
            {credits.balance < 1 ? <p className="type-small text-fg-muted">{copy.ask.noCredit}</p> : null}
            <ActionForm action={createReviewRequestAction} submitLabel={copy.ask.submit} successMessage={copy.ask.sent} variant="primary" className="flex flex-col items-start gap-2">
              <Input label={copy.ask.label} name="prUrl" type="url" required description={copy.ask.help} />
            </ActionForm>
            <p className="type-small text-fg-muted">{copy.rules(rules.minLineComments, rules.claimTtlHours)}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
