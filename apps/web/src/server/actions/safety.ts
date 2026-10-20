'use server';

import { blockMember, reportMember, submitFeedback, unblockMember } from '@commitmates/core';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { requireUser, requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/** Blocks or unblocks a member (CLAUDE.md §8 F12); the pressed button says which. */
export const blockAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('safety.block', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const input = { userId: field(formData, 'userId') };
    if (field(formData, 'intent') === 'unblock') await unblockMember(member, input);
    else await blockMember(member, input);
    revalidatePath('/', 'layout');
    return null;
  })();

/** Reports a member, optionally about one message (CLAUDE.md §8 F12 "Reports and auto-hide"). */
export const reportAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('safety.report', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const messageId = field(formData, 'messageId');
    await reportMember(member, {
      targetUserId: field(formData, 'targetUserId'),
      messageId: messageId === '' ? null : messageId,
      reason: field(formData, 'reason'),
      details: field(formData, 'details'),
    });
    return null;
  })();

/** Feedback or an appeal from any signed-in member, including one whose account is hidden for review. */
export const feedbackAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('safety.feedback', async (): Promise<null> => {
    const member = await requireUser();
    await guardWriteRate(member.id);
    await submitFeedback(member, { page: field(formData, 'page'), body: field(formData, 'body') });
    return null;
  })();
