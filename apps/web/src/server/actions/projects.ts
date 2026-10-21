'use server';

import { addLegacyEntry, dismissSuggestion, listRepo, relistRepo, removeLegacyEntry, withdrawRepo } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Lists one of the member's own repositories for adoption (CLAUDE.md §8 F14 "Listing"). */
export const listRepoAction: FormAction = async (_previous, formData) =>
  withAction('projects.list', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await listRepo(member, { repoGithubId: field(formData, 'repoGithubId'), note: field(formData, 'note') });
    revalidatePath('/settings/projects');
    return null;
  })();

/** Withdraws one of the member's listings. */
export const withdrawListingAction: FormAction = async (_previous, formData) =>
  withAction('projects.withdraw', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await withdrawRepo(member, { listingId: field(formData, 'listingId') });
    revalidatePath('/settings/projects');
    return null;
  })();

/** Hides a private suggestion for good. */
export const dismissSuggestionAction: FormAction = async (_previous, formData) =>
  withAction('projects.dismiss', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await dismissSuggestion(member, { repoGithubId: field(formData, 'repoGithubId') });
    revalidatePath('/settings/projects');
    return null;
  })();

/** Puts an adopted project back up for adoption after its adoption ended (CLAUDE.md §8 F14 "Revival tracking"). */
export const relistAction: FormAction = async (_previous, formData) =>
  withAction('projects.relist', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await relistRepo(member, { listingId: field(formData, 'listingId') });
    revalidatePath('/settings/projects');
    return null;
  })();

/** Showcases one of the member's repositories in Senior's Legacy (CLAUDE.md §8 F17 "Showcase"). */
export const addLegacyEntryAction: FormAction = async (_previous, formData) =>
  withAction('projects.showcase', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await addLegacyEntry(member, { repoGithubId: field(formData, 'repoGithubId'), blurb: field(formData, 'blurb'), acceptsQuestions: formData.get('acceptsQuestions') === 'on' });
    revalidatePath('/settings/projects');
    return null;
  })();

/** Removes a showcase entry. */
export const removeLegacyEntryAction: FormAction = async (_previous, formData) =>
  withAction('projects.unshowcase', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await removeLegacyEntry(member, { entryId: field(formData, 'entryId') });
    revalidatePath('/settings/projects');
    return null;
  })();
