'use server';

import {
  createEvent,
  createGroup,
  decideSquadSwap,
  finalizeSquads,
  joinEvent,
  joinGroup,
  leaveEvent,
  leaveGroup,
  requestFormation,
  requestSquadSwap,
} from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Days of the week the free-time form lists, Sunday first like `Date#getDay`. */
const WEEKDAYS = 7;

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Free time from the join form: one from–until pair per weekday; days left on "not free" are skipped. */
function availabilityFrom(formData: FormData): { weekday: number; from: number; to: number }[] {
  const blocks: { weekday: number; from: number; to: number }[] = [];
  for (let weekday = 0; weekday < WEEKDAYS; weekday += 1) {
    const from = field(formData, `from-${weekday}`);
    const to = field(formData, `to-${weekday}`);
    if (from === '' || to === '') continue;
    blocks.push({ weekday, from: Number(from), to: Number(to) });
  }
  return blocks;
}

/** Creates an event and opens it (CLAUDE.md §8 F21). */
export const createEventAction: FormAction = async (_previous, formData) =>
  withAction('events.create', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const teamSize = field(formData, 'teamSize');
    const id = await createEvent(member, {
      title: field(formData, 'title'),
      description: field(formData, 'description'),
      visibility: field(formData, 'visibility'),
      startsOn: field(formData, 'startsOn'),
      endsOn: field(formData, 'endsOn'),
      ...(teamSize === '' ? {} : { teamSize }),
    });
    revalidatePath('/events');
    redirect(`/events/${id}`);
  })();

/** Joins an event or saves the member's free time in it. */
export const joinEventAction: FormAction = async (_previous, formData) =>
  withAction('events.join', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const eventId = field(formData, 'eventId');
    await joinEvent(member, { eventId, availability: availabilityFrom(formData) });
    revalidatePath(`/events/${eventId}`);
    return null;
  })();

/** Runs one of the event's simple member actions and refreshes the page. */
function eventAction(name: string, run: (member: Awaited<ReturnType<typeof requireVerified>>, formData: FormData) => Promise<unknown>): FormAction {
  return async (_previous, formData) =>
    withAction(`events.${name}`, async () => {
      const member = await requireVerified();
      await guardWriteRate(member.id);
      await run(member, formData);
      revalidatePath(`/events/${field(formData, 'eventId')}`);
      revalidatePath('/events');
      return null;
    })();
}

export const leaveEventAction: FormAction = eventAction('leave', (member, formData) => leaveEvent(member, { eventId: field(formData, 'eventId') }));
export const createGroupAction: FormAction = eventAction('group.create', (member, formData) => createGroup(member, { eventId: field(formData, 'eventId') }));
export const joinGroupAction: FormAction = eventAction('group.join', (member, formData) =>
  joinGroup(member, { eventId: field(formData, 'eventId'), code: field(formData, 'code') }),
);
export const leaveGroupAction: FormAction = eventAction('group.leave', (member, formData) => leaveGroup(member, { eventId: field(formData, 'eventId') }));
export const formSquadsAction: FormAction = eventAction('form', (member, formData) => requestFormation(member, { eventId: field(formData, 'eventId') }));
export const finalizeSquadsAction: FormAction = eventAction('finalize', (member, formData) => finalizeSquads(member, { eventId: field(formData, 'eventId') }));
export const requestSquadSwapAction: FormAction = eventAction('swap.request', (member, formData) => requestSquadSwap(member, { squadId: field(formData, 'squadId') }));
export const decideSquadSwapAction: FormAction = eventAction('swap.decide', (member, formData) =>
  decideSquadSwap(member, { requestId: field(formData, 'requestId'), accept: field(formData, 'accept') === 'true' }),
);
