'use server';

import { answerSuggestion, requestFromSuggestion, updateLearningGoals } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Like a suggestion (CLAUDE.md §8 F11 "UI"): the card leaves the deck and joins today's liked list. */
export const likeSuggestionAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('discover.like', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await answerSuggestion(member, 'liked', { suggestionId: field(formData, 'suggestionId') });
    revalidatePath('/discover');
    return null;
  })();

/** Skip a suggestion: the card leaves the deck for today. */
export const skipSuggestionAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('discover.skip', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await answerSuggestion(member, 'skipped', { suggestionId: field(formData, 'suggestionId') });
    revalidatePath('/discover');
    return null;
  })();

/** Request chat from a suggestion, with a first message (CLAUDE.md §8 F12 "Message requests"). */
export const requestFromSuggestionAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('discover.request', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await requestFromSuggestion(member, { suggestionId: field(formData, 'suggestionId'), message: field(formData, 'message') });
    revalidatePath('/discover');
    return null;
  })();

/** Saves learning goals from Discover's prompt for members whose GitHub has no skill tags yet. */
export const saveLearningGoalsAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('discover.goals', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await updateLearningGoals(member, { learningGoals: field(formData, 'learningGoals') });
    revalidatePath('/discover');
    return null;
  })();
