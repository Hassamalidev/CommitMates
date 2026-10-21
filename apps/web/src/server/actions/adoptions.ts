'use server';

import { linkFork, recordAdoptionInterest, requestAdoption } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Asks the owner of a listing at the member's university to let them adopt it (CLAUDE.md §8 F14 step 1). */
export const requestAdoptionAction: FormAction = async (_previous, formData) =>
  withAction('adoptions.request', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await requestAdoption(member, { listingId: field(formData, 'listingId'), message: field(formData, 'message') });
    revalidatePath('/settings/projects');
    return null;
  })();

/**
 * Records that a member forked or asked about a project from the global Graveyard (§8 F7 "Members"),
 * so a revival can be tracked later. Called when they follow the link; the link opens either way.
 */
export async function recordAdoptionInterestAction(repoGithubId: number): Promise<ActionResult<{ recorded: boolean }>> {
  return withAction('adoptions.interest', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    return { recorded: await recordAdoptionInterest(member, { repoGithubId }) };
  })();
}

/** Links the fork an adopter works in (§8 F14 step 3). */
export const linkForkAction: FormAction = async (_previous, formData) =>
  withAction('adoptions.fork', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await linkFork(member, { adoptionId: field(formData, 'adoptionId'), fork: field(formData, 'fork') });
    revalidatePath('/settings/projects');
    return null;
  })();
