import { getStreaks } from '@commitmates/core';
import { Card, CompanionView, EmptyState, StateChip, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { EndPair } from '@/components/streaks/EndPair';
import { InviteResponse } from '@/components/streaks/InviteResponse';
import { streaksCopy } from '@/copy/streaks';
import { brandCompanion } from '@/lib/brand';
import { cancelPairInviteAction, resumePairAction } from '@/server/actions/streaks';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: streaksCopy.meta.title, robots: { index: false } };
}

const STATUS_STATE = { active: 'done', paused: 'waiting', ended: 'idle' } as const;

/** Shared streaks (CLAUDE.md §8 F13): invitations both ways and the member's pairs. */
export default async function StreaksPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/streaks');
  const { pairs, invites } = await getStreaks(member);
  const copy = streaksCopy;
  const nameOf = (person: { login: string; name: string | null }) => person.name ?? `@${person.login}`;

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <header>
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 mt-1">{copy.title}</h1>
        <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
      </header>

      {invites.incoming.length > 0 ? (
        <Card title={copy.invitesTitle} titleAs="h2" className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {invites.incoming.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-2">
                <p className="type-body">{copy.invitedYou(nameOf(invite))}</p>
                <InviteResponse inviteId={invite.id} login={invite.login} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section aria-labelledby="pairs-title" className="flex flex-col gap-3">
        <h2 id="pairs-title" className="type-h2">
          {copy.pairsTitle}
        </h2>
        {pairs.length === 0 ? (
          <Card>
            <EmptyState
              companion={<CompanionView companion={brandCompanion} state="idle" size={96} label={copy.pairsTitle} />}
              title={copy.empty.title}
              description={copy.empty.line}
              action={
                <Link href="/inbox" className={buttonStyles({ variant: 'secondary', size: 'md' })}>
                  {copy.inboxLink}
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {pairs.map((pair) => (
              <li key={pair.id}>
                <article aria-label={copy.pair.with(nameOf(pair.partner))} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="type-h3">{copy.pair.with(nameOf(pair.partner))}</h3>
                    <StateChip state={STATUS_STATE[pair.status]} label={copy.pair.status[pair.status]} />
                  </header>
                  <dl className="grid grid-cols-3 gap-2">
                    <div>
                      <dt className="type-small text-fg-muted">{copy.pair.currentLabel}</dt>
                      <dd className="type-h2">{copy.pair.current(pair.currentStreak)}</dd>
                    </div>
                    <div>
                      <dt className="type-small text-fg-muted">{copy.pair.longestLabel}</dt>
                      <dd className="type-body">{copy.pair.current(pair.longestStreak)}</dd>
                    </div>
                    <div>
                      <dt className="type-small text-fg-muted">{copy.pair.freezesLabel}</dt>
                      <dd className="type-body">{pair.freezesAvailable}</dd>
                    </div>
                  </dl>
                  <p className="type-small text-fg-muted">{pair.lastJudgedDay ? copy.pair.lastJudged(pair.lastJudgedDay) : copy.pair.notJudged}</p>
                  {pair.status === 'paused' ? <p className="type-small">{copy.pair.paused}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {pair.status === 'paused' ? (
                      <ActionForm action={resumePairAction} values={{ pairId: pair.id }} submitLabel={copy.pair.resume} variant="primary" />
                    ) : null}
                    <EndPair pairId={pair.id} />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invites.outgoing.length > 0 ? (
        <Card title={copy.sentTitle} titleAs="h2" className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {invites.outgoing.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="type-body">{copy.waitingFor(nameOf(invite))}</span>
                <ActionForm action={cancelPairInviteAction} values={{ inviteId: invite.id }} submitLabel={copy.cancelLabel(invite.login)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
