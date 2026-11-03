'use server';

import { answerQuestion, askQuestion, correctGraduation, passQuestion } from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

type FormAction = (previous: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>;

/** Asks the university's alumni a question (CLAUDE.md §8 F20); topics are comma-separated. */
export const askQuestionAction: FormAction = async (_previous, formData) =>
  withAction('alumni.ask', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const tags = field(formData, 'tags')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    await askQuestion(member, { body: field(formData, 'body'), tags, anonymous: formData.get('anonymous') === 'on' });
    revalidatePath('/alumni');
    return null;
  })();

/** Answers a question routed to the member and opens the conversation (§8 F20 "Answering"). */
export const answerQuestionAction: FormAction = async (_previous, formData) =>
  withAction('alumni.answer', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const threadId = await answerQuestion(member, { questionId: field(formData, 'questionId') });
    revalidatePath('/alumni');
    revalidatePath('/inbox');
    redirect(`/inbox/${threadId}`);
  })();

/** Passes on a question so it moves on to other alumni. */
export const passQuestionAction: FormAction = async (_previous, formData) =>
  withAction('alumni.pass', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await passQuestion(member, { questionId: field(formData, 'questionId') });
    revalidatePath('/alumni');
    return null;
  })();

/** Corrects an alumnus' graduation year after the role transition. */
export const correctGraduationAction: FormAction = async (_previous, formData) =>
  withAction('alumni.graduation', async () => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await correctGraduation(member, { gradYear: field(formData, 'gradYear') });
    revalidatePath('/alumni');
    return null;
  })();
