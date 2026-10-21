'use server';

import { respondToProposal, setOffers, setWants } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};
const fields = (formData: FormData, name: string) => formData.getAll(name).map((value) => (typeof value === 'string' ? value : ''));

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Saves the member's self-declared offers, comma-separated (CLAUDE.md §8 F16 "Offers and wants"). */
export const setOffersAction: FormAction = async (_previous, formData) =>
  withAction('swaps.offers', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await setOffers(member, { selfDeclared: field(formData, 'selfDeclared').split(',') });
    revalidatePath('/swaps');
    return null;
  })();

/** Saves the member's wants: rows of a skill and a priority; empty rows are dropped. */
export const setWantsAction: FormAction = async (_previous, formData) =>
  withAction('swaps.wants', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const tags = fields(formData, 'tag');
    const priorities = fields(formData, 'priority');
    const wants = tags.flatMap((tag, index) => (tag.trim() === '' ? [] : [{ tag, priority: priorities[index] ?? '' }]));
    await setWants(member, { wants });
    revalidatePath('/swaps');
    return null;
  })();

/** Accepts or declines a swap proposal (§8 F16 "Accepting"). */
export const respondToProposalAction: FormAction = async (_previous, formData) =>
  withAction('swaps.respond', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await respondToProposal(member, { proposalId: field(formData, 'proposalId'), response: field(formData, 'response') });
    revalidatePath('/swaps');
    revalidatePath('/inbox');
    return null;
  })();
