import { getEventView } from '@commitmates/core';
import { Card, Chip, EmptyState, Input, Select, StateChip, UnlockCard } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { eventsCopy } from '@/copy/events';
import { formatDaySpan } from '@/lib/format';
import {
  createGroupAction,
  decideSquadSwapAction,
  finalizeSquadsAction,
  formSquadsAction,
  joinEventAction,
  joinGroupAction,
  leaveEventAction,
  leaveGroupAction,
  requestSquadSwapAction,
} from '@/server/actions/events';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: eventsCopy.meta.title, robots: { index: false } };
}

const copy = eventsCopy;
const STATUS_STATE = { open: 'idle', forming: 'working', finalized: 'done', closed: 'idle' } as const;
/** Hours offered for the start and end of a free time: 0 to 24. */
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

type Props = { params: Promise<{ id: string }> };

/** One event (CLAUDE.md §8 F21 "Routes": join, availability, lock a group, see proposals). */
export default async function EventPage({ params }: Props) {
  const member = await getCurrentMember();
  const { id } = await params;
  if (!member) redirect(`/auth/sign-in?next=/events/${id}`);
  if (member.universityId === null) redirect('/onboarding');
  const view = await getEventView(member, id).catch(() => null);
  if (!view) notFound();
  const { event } = view;
  const span = formatDaySpan(event.startsAt, event.endsAt, member.timezone);
  const values = { eventId: event.id };
  const open = event.status === 'open';
  const current = view.squads[0];
  const proposed = current?.status === 'proposed';
  const teamIndex = new Map(view.squads.map((squad, index) => [squad.id, index + 1]));
  const free = new Map(view.me.availability.map((block) => [block.weekday, block]));
  const hourOptions = (withNone: boolean) => [
    ...(withNone ? [{ value: '', label: copy.join.notFree }] : []),
    ...HOURS.map((hour) => ({ value: String(hour), label: copy.join.hour(hour) })),
  ];

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <Link href="/events" className="type-small inline-flex min-h-11 items-center self-start underline">
        {copy.event.back}
      </Link>
      <header className="flex flex-col gap-2">
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 break-words">{event.title}</h1>
        <p className="type-small text-fg-muted">
          {[copy.dates(span.from, span.to), copy.visibility[event.visibility], copy.teamSize(event.teamSize), copy.event.by(view.organizerLogin)].join(' · ')}
        </p>
        <StateChip state={STATUS_STATE[event.status]} label={copy.status[event.status]} />
        {event.description ? <p className="type-body max-w-reading break-words whitespace-pre-line">{event.description}</p> : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {!view.unlock.unlocked && view.squads.length === 0 ? (
            <UnlockCard
              title={copy.event.lockedTitle}
              description={copy.event.locked(view.unlock.required)}
              current={view.unlock.current}
              required={view.unlock.required}
              progressLabel={copy.event.progress(view.unlock.current, view.unlock.required)}
            />
          ) : null}

          <section aria-labelledby="teams-title" className="flex flex-col gap-3">
            <h2 id="teams-title" className="type-h2">
              {copy.teams.title}
            </h2>
            {event.status === 'forming' && !proposed ? <p className="type-small">{copy.teams.forming}</p> : null}
            {current ? <p className="type-small text-fg-muted">{proposed ? copy.teams.proposed : copy.teams.final}</p> : null}
            {view.myRequest ? <p className="type-small">{copy.teams.request[view.myRequest.status as keyof typeof copy.teams.request]}</p> : null}
            {view.squads.length === 0 ? (
              event.status === 'forming' ? null : (
                <Card>
                  <EmptyState title={copy.teams.title} description={copy.event.locked(view.unlock.required)} />
                </Card>
              )
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {view.squads.map((squad, index) => {
                  const mine = squad.id === view.mySquadId;
                  const name = copy.teams.team(index + 1);
                  return (
                    <li key={squad.id}>
                      <Card as="article" aria-label={name} className={`flex flex-col gap-2 ${mine ? 'border-accent' : ''}`}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="type-body font-semibold">{name}</span>
                          {mine ? <Chip>{copy.teams.yours}</Chip> : null}
                        </span>
                        <ul className="type-small flex flex-col gap-1">
                          {squad.members.map((teammate) => (
                            <li key={teammate.userId}>
                              <span className="font-semibold">{copy.teams.member(teammate.login)}</span> <span className="text-fg-muted">· {copy.teams.role(teammate.roleLabel)}</span>
                            </li>
                          ))}
                        </ul>
                        {proposed && !mine && view.mySquadId && !view.myRequest ? (
                          <ActionForm action={requestSquadSwapAction} values={{ ...values, squadId: squad.id }} submitLabel={copy.teams.switchHere(index + 1)} successMessage={copy.teams.requested} variant="ghost" />
                        ) : null}
                        {mine && squad.threadId ? (
                          <Link href={`/inbox/${squad.threadId}`} className="type-small text-accent underline underline-offset-4">
                            {copy.teams.conversation}
                          </Link>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4" aria-label={copy.join.title}>
          {open || view.me.joined ? (
            <Card title={copy.join.title} titleAs="h2" className="flex flex-col gap-3">
              {open ? (
                <>
                  <p className="type-small text-fg-muted">{copy.join.intro}</p>
                  <ActionForm
                    action={joinEventAction}
                    values={values}
                    submitLabel={view.me.joined ? copy.join.update : copy.join.join}
                    successMessage={view.me.joined ? copy.join.saved : copy.join.joined}
                    variant={view.me.joined ? 'secondary' : 'primary'}
                    className="flex flex-col items-start gap-3"
                  >
                    {copy.weekdays.map((day, weekday) => (
                      <fieldset key={day} className="grid w-full grid-cols-2 gap-2">
                        <legend className="type-small mb-1 font-semibold">{copy.join.day(day)}</legend>
                        <Select label={copy.join.from(day)} name={`from-${weekday}`} defaultValue={free.has(weekday) ? String(free.get(weekday)?.from) : ''} options={hourOptions(true)} />
                        <Select label={copy.join.to(day)} name={`to-${weekday}`} defaultValue={free.has(weekday) ? String(free.get(weekday)?.to) : ''} options={hourOptions(true)} />
                      </fieldset>
                    ))}
                  </ActionForm>
                  {view.me.joined ? <ActionForm action={leaveEventAction} values={values} submitLabel={copy.join.leave} successMessage={copy.join.left} variant="ghost" /> : null}
                </>
              ) : (
                <p className="type-small">{copy.join.closed}</p>
              )}
            </Card>
          ) : null}

          {open && view.me.joined ? (
            <Card title={copy.group.title} titleAs="h2" className="flex flex-col gap-3">
              <p className="type-small text-fg-muted">{copy.group.intro}</p>
              {view.me.groupCode ? (
                <>
                  <p className="type-small">{copy.group.yours(view.me.groupCode, view.me.groupSize)}</p>
                  <ActionForm action={leaveGroupAction} values={values} submitLabel={copy.group.leave} successMessage={copy.group.left} variant="ghost" />
                </>
              ) : (
                <>
                  <ActionForm action={createGroupAction} values={values} submitLabel={copy.group.create} />
                  <ActionForm action={joinGroupAction} values={values} submitLabel={copy.group.joinGroup} successMessage={copy.group.joined} className="flex flex-col items-start gap-2">
                    <Input label={copy.group.code} name="code" description={copy.group.codeHelp} autoComplete="off" />
                  </ActionForm>
                </>
              )}
            </Card>
          ) : null}

          {view.isOrganizer ? (
            <Card title={copy.organizer.title} titleAs="h2" className="flex flex-col gap-3">
              <div>
                <h3 className="type-small font-semibold">{copy.organizer.participants}</h3>
                {view.participantLogins && view.participantLogins.length > 0 ? (
                  <ul className="type-small mt-1 flex flex-wrap gap-2">
                    {view.participantLogins.map((login, index) => (
                      <li key={login ?? `member-${index}`}>
                        <Chip>{copy.teams.member(login)}</Chip>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="type-small text-fg-muted">{copy.organizer.noParticipants}</p>
                )}
              </div>
              {(open || event.status === 'forming') && view.unlock.unlocked ? (
                <>
                  <p className="type-small text-fg-muted">{copy.organizer.formHelp}</p>
                  <ActionForm action={formSquadsAction} values={values} submitLabel={current ? copy.organizer.reform : copy.organizer.form} successMessage={copy.organizer.formed} variant={current ? 'secondary' : 'primary'} />
                </>
              ) : null}
              {proposed ? (
                <>
                  <h3 className="type-small font-semibold">{copy.organizer.swaps}</h3>
                  {view.pendingSwaps.length === 0 ? (
                    <p className="type-small text-fg-muted">{copy.organizer.noSwaps}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {view.pendingSwaps.map((swap) => (
                        <li key={swap.id} className="flex flex-col gap-1">
                          <span className="type-small">{copy.organizer.swapLine(swap.login, teamIndex.get(swap.toSquadId) ?? 0)}</span>
                          <span className="flex flex-wrap gap-2">
                            <ActionForm action={decideSquadSwapAction} values={{ ...values, requestId: swap.id, accept: 'true' }} submitLabel={copy.organizer.apply} successMessage={copy.organizer.applied} variant="primary" />
                            <ActionForm action={decideSquadSwapAction} values={{ ...values, requestId: swap.id, accept: 'false' }} submitLabel={copy.organizer.refuse} successMessage={copy.organizer.applied} variant="ghost" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="type-small text-fg-muted">{copy.organizer.finalizeHelp}</p>
                  <ActionForm action={finalizeSquadsAction} values={values} submitLabel={copy.organizer.finalize} successMessage={copy.organizer.finalized} variant="primary" />
                </>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
