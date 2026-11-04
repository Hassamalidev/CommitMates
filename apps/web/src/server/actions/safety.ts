'use server';

import { blockMember, reportMember, submitFeedback, unblockMember } from '@commitmates/core';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { withAction, type ActionResult } from '@/server/action';
import { getCurrentMember } from '@/server/auth';
import { requireVerified } from '@/server/guards';
import { guardToolRate, guardWriteRate } from '@/server/rate';

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
    // Open to visitors too (§9.6 footer): members are rate-limited per account, visitors per hashed address.
    const member = await getCurrentMember();
    if (member) await guardWriteRate(member.id);
    else await guardToolRate('feedback', await headers());
    await submitFeedback(member, { page: field(formData, 'page'), body: field(formData, 'body') });
    return null;
  })();
