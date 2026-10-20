'use server';

import { deleteMessage, editMessage, leaveThread, markRead, muteThread, respondToRequest, sendMessage } from '@commitmates/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { withAction, type ActionResult } from '@/server/action';
import { requireVerified } from '@/server/guards';
import { guardWriteRate } from '@/server/rate';

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

/**
 * Accept or decline a message request (CLAUDE.md §8 F12 step 4); the pressed button says which.
 * Accepting opens the conversation.
 */
export const respondToRequestAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('chat.respond', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const { threadId } = await respondToRequest(member, { requestId: field(formData, 'requestId'), accept: field(formData, 'intent') === 'accept' });
    revalidatePath('/inbox');
    if (threadId) redirect(`/inbox/${threadId}`);
    return null;
  })();

export type SentMessage = { id: string; createdAt: string };

/** Posts a message to a thread the member is in (§8 F12 "Messages"). */
export const sendMessageAction = async (_previous: ActionResult<SentMessage> | null, formData: FormData) =>
  withAction('chat.send', async (): Promise<SentMessage> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const threadId = field(formData, 'threadId');
    const message = await sendMessage(member, { threadId, body: field(formData, 'body') });
    revalidatePath(`/inbox/${threadId}`);
    return { id: message.id, createdAt: message.createdAt.toISOString() };
  })();

/** Edits the member's own message within the edit window. */
export const editMessageAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('chat.edit', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const message = await editMessage(member, { messageId: field(formData, 'messageId'), body: field(formData, 'body') });
    revalidatePath(`/inbox/${message.threadId}`);
    return null;
  })();

/** Deletes the member's own message; the thread shows that it was deleted. */
export const deleteMessageAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('chat.delete', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await deleteMessage(member, { messageId: field(formData, 'messageId') });
    revalidatePath(`/inbox/${field(formData, 'threadId')}`);
    return null;
  })();

/** Marks a thread read; called when new messages arrive while the conversation is open. */
export async function markReadAction(threadId: string): Promise<ActionResult<null>> {
  return withAction('chat.read', async (): Promise<null> => {
    const member = await requireVerified();
    await markRead(member, { threadId });
    return null;
  })();
}

/** Mutes or unmutes a thread. */
export const muteThreadAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('chat.mute', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    const threadId = field(formData, 'threadId');
    await muteThread(member, { threadId, muted: field(formData, 'muted') === 'true' });
    revalidatePath(`/inbox/${threadId}`);
    revalidatePath('/inbox');
    return null;
  })();

/** Leaves a thread and returns to the inbox. */
export const leaveThreadAction = async (_previous: ActionResult<null> | null, formData: FormData) =>
  withAction('chat.leave', async (): Promise<null> => {
    const member = await requireVerified();
    await guardWriteRate(member.id);
    await leaveThread(member, { threadId: field(formData, 'threadId') });
    revalidatePath('/inbox');
    redirect('/inbox');
  })();
