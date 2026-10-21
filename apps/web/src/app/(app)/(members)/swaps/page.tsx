import { campusUnlocks, getSwaps, getUniversity, inviteFor } from '@commitmates/core';
import { Card, Chip, EmptyState, Input, Select, StateChip, UnlockCard } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { ActionForm } from '@/components/forms/ActionForm';
import { campusCopy } from '@/copy/campus';
import { swapsCopy } from '@/copy/swaps';
import { formatUtc } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import { respondToProposalAction, setOffersAction, setWantsAction } from '@/server/actions/swaps';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: swapsCopy.meta.title, robots: { index: false } };
}

/** Empty rows offered for new wants, within `swap.maxWants`. */
const BLANK_WANT_ROWS = 2;

const STATUS_STATE = { proposed: 'waiting', accepted: 'done', declined: 'idle', expired: 'idle' } as const;

/** The Skill Swap (CLAUDE.md §8 F16): proposals to answer, what the member can teach and wants to learn. */
export default async function SwapsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/swaps');
  if (member.universityId === null) redirect('/onboarding');
  const copy = swapsCopy;
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
    </header>
  );

  const unlock = (await campusUnlocks(member.universityId)).unlocks.find((entry) => entry.key === 'swap');
  if (!unlock?.unlocked) {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.swap.title}
          description={copy.locked}
          current={unlock?.current ?? 0}
          required={unlock?.required ?? 0}
          progressLabel={campusCopy.progress.members(unlock?.current ?? 0, unlock?.required ?? 0)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
      </div>
    );
  }

  const view = await getSwaps(member);
  const { rules } = view;
  // Every proposal carries the same login map of the people in the member's proposals.
  const logins = view.proposals[0]?.logins ?? {};
  const who = (id: string) => (id === member.id ? copy.proposals.you : copy.proposals.member(logins[id] ?? null));
  const wantRows = [...view.wants, ...Array.from({ length: Math.max(0, Math.min(BLANK_WANT_ROWS, rules.maxWants - view.wants.length)) }, () => null)];
  const priorityOptions = Array.from({ length: rules.maxPriority }, (_, index) => ({ value: String(index + 1), label: copy.wants.priorities(index + 1, rules.maxPriority) }));

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}

      <section aria-labelledby="proposals-title" className="flex flex-col gap-3">
        <h2 id="proposals-title" className="type-h2">
          {copy.proposals.title}
        </h2>
        {view.proposals.length === 0 ? (
          <Card>
            <EmptyState title={copy.proposals.title} description={copy.proposals.empty} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.proposals.map((proposal) => {
              const people = proposal.members.filter((id) => id !== member.id).map(who).join(', ');
              const mine = proposal.responses.find((response) => response.userId === member.id)?.response;
              return (
                <li key={proposal.id}>
                  <Card as="article" aria-label={people} className="flex flex-col gap-2">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="type-body font-semibold">{people}</span>
                      <StateChip state={STATUS_STATE[proposal.status]} label={copy.proposals.status[proposal.status]} />
                    </span>
                    <ul className="type-small flex list-disc flex-col gap-1 pl-5">
                      {proposal.edges.map((edge) => (
                        <li key={`${edge.from}-${edge.to}`}>{copy.proposals.edge(who(edge.from), who(edge.to), edge.tag)}</li>
                      ))}
                    </ul>
                    {proposal.status === 'proposed' && mine === undefined ? (
                      <>
                        <p className="type-small text-fg-muted">{copy.proposals.until(`${formatUtc(proposal.expiresAt) ?? ''} UTC`)}</p>
                        <div className="flex flex-wrap gap-2">
                          <ActionForm action={respondToProposalAction} values={{ proposalId: proposal.id, response: 'accept' }} submitLabel={copy.proposals.accept(people)} variant="primary" />
                          <ActionForm action={respondToProposalAction} values={{ proposalId: proposal.id, response: 'decline' }} submitLabel={copy.proposals.decline(people)} variant="ghost" />
                        </div>
                      </>
                    ) : null}
                    {proposal.status === 'proposed' && mine === 'accept' ? <p className="type-small">{copy.proposals.waiting}</p> : null}
                    {proposal.status === 'accepted' ? (
                      <p className="type-small">
                        {copy.proposals.accepted}{' '}
                        <Link href="/inbox" className="text-accent underline underline-offset-4">
                          {copy.proposals.inbox}
                        </Link>
                      </p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={copy.offers.title} titleAs="h2" className="flex flex-col gap-3">
          <p className="type-small text-fg-muted">{view.verifiedOffers.length === 0 ? copy.offers.verifiedEmpty : copy.offers.verifiedIntro}</p>
          {view.verifiedOffers.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label={copy.offers.verifiedBadge}>
              {view.verifiedOffers.map((offer) => (
                <li key={offer.tag} className="type-small flex flex-wrap items-center gap-2">
                  <Chip>{offer.tag}</Chip>
                  <span className="text-fg-muted">
                    {copy.offers.verifiedBadge} · {copy.offers.level(offer.level)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {view.selfDeclared.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={copy.offers.selfBadge}>
              {view.selfDeclared.map((tag) => (
                <li key={tag}>
                  <Chip>{`${tag} · ${copy.offers.selfBadge}`}</Chip>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={setOffersAction} submitLabel={copy.offers.save} successMessage={copy.offers.saved} className="flex flex-col items-start gap-2">
            <Input label={copy.offers.selfLabel} name="selfDeclared" defaultValue={view.selfDeclared.join(', ')} description={copy.offers.selfHelp(rules.maxSelfDeclared)} />
          </ActionForm>
        </Card>

        <Card title={copy.wants.title} titleAs="h2" className="flex flex-col gap-3">
          <p className="type-small text-fg-muted">{copy.wants.intro}</p>
          <ActionForm action={setWantsAction} submitLabel={copy.wants.save} successMessage={copy.wants.saved} className="flex flex-col items-start gap-3">
            {wantRows.map((want, index) => (
              <div key={want?.tag ?? `blank-${index}`} className="grid w-full gap-2 sm:grid-cols-[1fr_auto]">
                <Input label={copy.wants.tag(index + 1)} name="tag" defaultValue={want?.tag ?? ''} description={want?.fromGoals ? copy.wants.fromGoals : undefined} />
                <Select label={copy.wants.priority(index + 1)} name="priority" defaultValue={String(want?.priority ?? rules.maxPriority)} options={priorityOptions} />
              </div>
            ))}
            <p className="type-small text-fg-muted">{copy.wants.help(rules.maxWants)}</p>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
