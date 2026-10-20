'use server';

import { cancelPairInvite, endPair, invitePair, respondToPairInvite, resumePair } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Invites the other member of a conversation to a shared streak (CLAUDE.md §8 F13 "Pairing"). */
export const invitePairAction: FormAction = async (_previous, formData) =>
  withAction('streaks.invite', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const threadId = field(formData, 'threadId');
    await invitePair(member, { threadId });
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath('/streaks');
    return null;
  })();

/** Accepts or declines a streak invitation; the pressed button says which. */
export const respondPairInviteAction: FormAction = async (_previous, formData) =>
  withAction('streaks.respond', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await respondToPairInvite(member, { inviteId: field(formData, 'inviteId'), accept: field(formData, 'intent') === 'accept' });
    revalidatePath('/streaks');
    return null;
  })();

/** Withdraws the member's own invitation. */
export const cancelPairInviteAction: FormAction = async (_previous, formData) =>
  withAction('streaks.cancel', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await cancelPairInvite(member, { inviteId: field(formData, 'inviteId') });
    revalidatePath('/streaks');
    return null;
  })();

/** Ends a pair. */
export const endPairAction: FormAction = async (_previous, formData) =>
  withAction('streaks.end', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await endPair(member, { pairId: field(formData, 'pairId') });
    revalidatePath('/streaks');
    return null;
  })();

/** Resumes a paused pair. */
export const resumePairAction: FormAction = async (_previous, formData) =>
  withAction('streaks.resume', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await resumePair(member, { pairId: field(formData, 'pairId') });
    revalidatePath('/streaks');
    return null;
  })();
