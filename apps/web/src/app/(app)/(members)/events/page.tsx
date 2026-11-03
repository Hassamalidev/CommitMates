import { getSetting, listEvents } from '@commitmates/core';
import { Card, Chip, EmptyState, Input, Select, StateChip, Textarea } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { eventsCopy } from '@/copy/events';
import { formatDaySpan } from '@/lib/format';
import { createEventAction } from '@/server/actions/events';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: eventsCopy.meta.title, robots: { index: false } };
}

const copy = eventsCopy;
const STATUS_STATE = { open: 'idle', forming: 'working', finalized: 'done', closed: 'idle' } as const;

/** Events (CLAUDE.md §8 F21 "Routes": list, create). */
export default async function EventsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/events');
  if (member.universityId === null) redirect('/onboarding');
  const [events, defaultSize, maxSize, titleMax, descriptionMax] = await Promise.all([
    listEvents(member),
    getSetting('squads.defaultTeamSize'),
    getSetting('squads.maxTeamSize'),
    getSetting('squads.titleMaxChars'),
    getSetting('squads.descriptionMaxChars'),
  ]);
  const visibilityOptions = (['university', 'country', 'public'] as const).map((value) => ({ value, label: copy.visibility[value] }));

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <header>
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 mt-1">{copy.title}</h1>
        <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="events-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="events-title" className="type-h2">
            {copy.list.title}
          </h2>
          {events.length === 0 ? (
            <Card>
              <EmptyState title={copy.list.title} description={copy.list.empty} />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {events.map((event) => {
                const span = formatDaySpan(event.startsAt, event.endsAt, member.timezone);
                return (
                  <li key={event.id}>
                    <Card as="article" aria-label={event.title} className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/events/${event.id}`} className="type-body font-semibold break-words underline">
                          {event.title}
                        </Link>
                        <StateChip state={STATUS_STATE[event.status]} label={copy.status[event.status]} />
                      </span>
                      <p className="type-small text-fg-muted">
                        {[copy.dates(span.from, span.to), copy.visibility[event.visibility], copy.teamSize(event.teamSize), copy.list.participants(event.participants)].join(' · ')}
                      </p>
                      {event.description ? <p className="type-small break-words whitespace-pre-line">{event.description}</p> : null}
                      <span className="flex flex-wrap gap-2">
                        {event.joined ? <Chip>{copy.list.joined}</Chip> : null}
                        {event.creatorUserId === member.id ? <Chip>{copy.list.organizer}</Chip> : null}
                      </span>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside aria-label={copy.create.title}>
          <Card title={copy.create.title} titleAs="h2">
            <ActionForm action={createEventAction} submitLabel={copy.create.submit} variant="primary" size="md" className="flex flex-col items-start gap-3">
              <Input label={copy.create.name} name="title" required maxLength={titleMax} className="w-full" />
              <Textarea label={copy.create.description} name="description" rows={3} maxLength={descriptionMax} description={copy.create.descriptionHelp(descriptionMax)} className="w-full" />
              <Select label={copy.visibility.label} name="visibility" defaultValue="university" options={visibilityOptions} />
              <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Input label={copy.create.startsOn} name="startsOn" type="date" required description={copy.create.datesHelp} />
                <Input label={copy.create.endsOn} name="endsOn" type="date" required />
              </div>
              <Input
                label={copy.create.teamSize}
                name="teamSize"
                type="number"
                inputMode="numeric"
                min={2}
                max={maxSize}
                defaultValue={defaultSize}
                description={copy.create.teamSizeHelp(maxSize)}
              />
            </ActionForm>
          </Card>
        </aside>
      </div>
    </div>
  );
}
