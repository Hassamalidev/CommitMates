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

export type AnswerResult = { action: 'liked' | 'skipped'; login: string };

/**
 * Like or Skip a suggestion (CLAUDE.md §8 F11 "UI"); the form's pressed button says which. A liked
 * card joins today's liked list; either way it leaves the deck. The login is echoed back only to
 * announce what happened.
 */
export const answerSuggestionAction = async (_previous: ActionResult<AnswerResult> | null, formData: FormData) =>
  withAction('discover.answer', async (): Promise<AnswerResult> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const action = field(formData, 'intent') === 'like' ? 'liked' : 'skipped';
    await answerSuggestion(member, action, { suggestionId: field(formData, 'suggestionId') });
    revalidatePath('/discover');
    return { action, login: field(formData, 'login') };
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
