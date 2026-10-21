import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  acceptReverseRequest,
  activateAdoption,
  addConnection,
  countUnread,
  createThread,
  findDirectThread,
  getChatParticipant,
  getDb,
  getLogin,
  getMessage,
  getSetting,
  getThread,
  insertMessage,
  insertNotification,
  isBlockedEitherWay,
  listIncomingRequests,
  listMessages,
  listOutgoingRequests,
  listThreadMembers,
  listThreadSummaries,
  lockIncomingRequest,
  markThreadRead,
  removeThreadMember,
  setRequestStatus,
  setThreadMuted,
  updateMessage,
  type IncomingRequest,
  type MessageRow,
  type OutgoingRequest,
  type ThreadMember,
  type ThreadSummary,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

import type { RequestContext } from './schemas';
import { checkMessageBody, type MessageRules } from './service';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_MINUTE = 60 * 1000; // allowed-literal: unit conversion

type ChatMember = Pick<Member, 'id'>;

/** System message bodies; the page renders each from copy. `left:<login>` names who left. */
export const SYSTEM_NOTES = { left: 'left' } as const;

/** Which connection a request's context makes once it is accepted (CLAUDE.md §7.6 `connections.source`). */
const CONNECTION_SOURCE = { discover: 'match', adoption: 'adoption', gap: 'match', oss: 'match', legacy: 'legacy' } as const satisfies Record<RequestContext, 'match' | 'adoption' | 'legacy'>;

/** The connection source for a stored context kind; features added later fall back to `match`. */
const connectionSourceFor = (kind: string) => (Object.hasOwn(CONNECTION_SOURCE, kind) ? CONNECTION_SOURCE[kind as RequestContext] : 'match');

const unreachable = () => new ForbiddenError('chat.unreachable', "You can't message this person right now.");
const noThread = () => new NotFoundError('chat.thread_missing', "That conversation doesn't exist or you're no longer in it.");
const requestGone = () => new NotFoundError('chat.request_gone', 'That request is no longer waiting for an answer.');

async function messageRules(): Promise<MessageRules & { editWindowMinutes: number }> {
  const [maxChars, newAccountDays, maxLinks, editWindowMinutes] = await Promise.all([
    getSetting('chat.maxMessageChars'),
    getSetting('chat.newAccountDays'),
    getSetting('chat.maxLinksNewAccount'),
    getSetting('chat.editWindowMinutes'),
  ]);
  return { maxChars, newAccountDays, maxLinks, editWindowMinutes };
}

export const respondSchema = z.object({ requestId: z.uuid(), accept: z.boolean() });

/**
 * Accepts or declines a request (CLAUDE.md §8 F12 "Message requests" step 4). Accepting opens a
 * direct thread (or reuses the one the two already share), posts the first message as the sender's,
 * records the connection, answers a pending request the other way round, and tells the sender.
 * Declining is silent: the sender keeps seeing "pending" until the request expires.
 */
export async function respondToRequest(member: ChatMember, raw: unknown, now: Date = new Date()): Promise<{ threadId: string | null }> {
  const { requestId, accept } = respondSchema.parse(raw);
  const ttlDays = await getSetting('chat.requestTtlDays');
  const result = await getDb().transaction(async (tx) => {
    const request = await lockIncomingRequest(requestId, member.id, tx);
    if (request?.status !== 'pending') throw requestGone();
    if (request.createdAt.getTime() < now.getTime() - ttlDays * MS_PER_DAY) {
      await setRequestStatus(request.id, 'expired', now, tx);
      return { expired: true as const };
    }
    if (!accept) {
      await setRequestStatus(request.id, 'declined', now, tx);
      return { threadId: null };
    }
    const [sender, blocked] = await Promise.all([getChatParticipant(request.fromUser, tx), isBlockedEitherWay(request.fromUser, member.id, tx)]);
    if (sender?.status !== 'active' || blocked) throw unreachable();

    const threadId = (await findDirectThread(request.fromUser, member.id, tx)) ?? (await createThread('direct', [request.fromUser, member.id], null, tx));
    await insertMessage({ threadId, authorUserId: request.fromUser, kind: 'user', body: request.firstMessage, createdAt: request.createdAt }, tx);
    await markThreadRead(threadId, member.id, now, tx);
    await setRequestStatus(request.id, 'accepted', now, tx);
    await acceptReverseRequest(member.id, request.fromUser, now, tx);
    await addConnection(request.fromUser, member.id, connectionSourceFor(request.contextKind), tx);
    // An accepted adoption request starts the adoption (CLAUDE.md §8 F14 "Adoption flow" step 2).
    if (request.contextKind === 'adoption' && request.contextId !== null) await activateAdoption(request.contextId, tx);
    await insertNotification(request.fromUser, 'chat_request_accepted', { login: await getLogin(member.id, tx), threadId }, tx);
    return { threadId };
  });
  if ('expired' in result) throw requestGone();
  return { threadId: result.threadId };
}

/** The thread and its members when the member is one of them; otherwise not found. */
async function memberThread(member: ChatMember, threadId: string) {
  const [thread, members] = await Promise.all([getThread(threadId), listThreadMembers(threadId)]);
  if (!thread || !members.some((entry) => entry.userId === member.id)) throw noThread();
  return { thread, members };
}

export const sendMessageSchema = z.object({ threadId: z.uuid(), body: z.string().trim() });

/**
 * Posts a message (CLAUDE.md §8 F12 "Messages"): only members of the thread who are active; in a
 * direct thread, not when either side has blocked the other. Length and link rules apply, and the
 * sender's own read marker moves past their message.
 */
export async function sendMessage(member: ChatMember, raw: unknown, now: Date = new Date()): Promise<MessageRow> {
  const { threadId, body } = sendMessageSchema.parse(raw);
  const [{ thread, members }, sender, rules] = await Promise.all([memberThread(member, threadId), getChatParticipant(member.id), messageRules()]);
  if (sender?.status !== 'active') throw unreachable();
  if (thread.kind === 'direct') {
    const other = members.find((entry) => entry.userId !== member.id);
    if (!other || (await isBlockedEitherWay(member.id, other.userId))) throw unreachable();
  }
  checkMessageBody(body, sender.createdAt, now, rules);
  const message = await insertMessage({ threadId, authorUserId: member.id, kind: 'user', body });
  await markThreadRead(threadId, member.id, message.createdAt);
  return message;
}

export const editMessageSchema = z.object({ messageId: z.uuid(), body: z.string().trim() });

/** The member's own message, still a live user message. */
async function ownMessage(member: ChatMember, messageId: string): Promise<MessageRow> {
  const message = await getMessage(messageId);
  if (message?.authorUserId !== member.id || message.kind !== 'user' || message.deletedAt !== null) {
    throw new NotFoundError('chat.message_missing', 'That message is gone or is not yours.');
  }
  return message;
}

/** Edits the member's own message within `chat.editWindowMinutes` of sending it. */
export async function editMessage(member: ChatMember, raw: unknown, now: Date = new Date()): Promise<MessageRow> {
  const { messageId, body } = editMessageSchema.parse(raw);
  const [message, sender, rules] = await Promise.all([ownMessage(member, messageId), getChatParticipant(member.id), messageRules()]);
  if (now.getTime() - message.createdAt.getTime() > rules.editWindowMinutes * MS_PER_MINUTE) {
    throw new ConflictError('chat.edit_window', `Messages can be edited for ${rules.editWindowMinutes} minutes after sending.`);
  }
  if (!sender) throw unreachable();
  checkMessageBody(body, sender.createdAt, now, rules);
  const updated = await updateMessage(message.id, { body, editedAt: now });
  if (!updated) throw new NotFoundError('chat.message_missing', 'That message is gone or is not yours.');
  return updated;
}

export const deleteMessageSchema = z.object({ messageId: z.uuid() });

/** Deletes the member's own message: its text is removed and the thread shows that it was deleted. */
export async function deleteMessage(member: ChatMember, raw: unknown, now: Date = new Date()): Promise<void> {
  const { messageId } = deleteMessageSchema.parse(raw);
  const message = await ownMessage(member, messageId);
  await updateMessage(message.id, { body: '', deletedAt: now });
}

export const threadActionSchema = z.object({ threadId: z.uuid() });
export const muteSchema = z.object({ threadId: z.uuid(), muted: z.boolean() });

/** Marks a thread read up to now. */
export async function markRead(member: ChatMember, raw: unknown, now: Date = new Date()): Promise<void> {
  const { threadId } = threadActionSchema.parse(raw);
  await memberThread(member, threadId);
  await markThreadRead(threadId, member.id, now);
}

/** Mutes or unmutes a thread: a muted thread does not count toward unread totals. */
export async function muteThread(member: ChatMember, raw: unknown): Promise<void> {
  const { threadId, muted } = muteSchema.parse(raw);
  if (!(await setThreadMuted(threadId, member.id, muted))) throw noThread();
}

/** Leaves a thread; the others see a note that the member left. */
export async function leaveThread(member: ChatMember, raw: unknown): Promise<void> {
  const { threadId } = threadActionSchema.parse(raw);
  const login = await getLogin(member.id);
  await getDb().transaction(async (tx) => {
    if (!(await removeThreadMember(threadId, member.id, tx))) throw noThread();
    await insertMessage({ threadId, authorUserId: null, kind: 'system', body: `${SYSTEM_NOTES.left}:${login ?? ''}` }, tx);
  });
}

export type OutgoingView = Omit<OutgoingRequest, 'status'> & { status: 'pending' | 'accepted' | 'expired' };

export type Inbox = { incoming: IncomingRequest[]; outgoing: OutgoingView[]; threads: ThreadSummary[]; unread: number };

/**
 * A member's inbox: requests waiting for them, requests they sent, and their threads. A declined
 * request reads as pending to its sender until it would have expired (§8 F12 step 4).
 */
export async function getInbox(member: ChatMember, now: Date = new Date()): Promise<Inbox> {
  const ttlDays = await getSetting('chat.requestTtlDays');
  const cutoff = new Date(now.getTime() - ttlDays * MS_PER_DAY);
  const [incoming, outgoing, threads, unread] = await Promise.all([
    listIncomingRequests(member.id, cutoff),
    listOutgoingRequests(member.id, cutoff),
    listThreadSummaries(member.id),
    countUnread(member.id),
  ]);
  return {
    incoming,
    outgoing: outgoing.map((request) => ({
      ...request,
      status: request.status === 'accepted' ? 'accepted' : request.status === 'expired' ? 'expired' : 'pending',
    })),
    threads,
    unread,
  };
}

/** Unread messages across the member's threads, for the home page and navigation. */
export function unreadCount(member: ChatMember): Promise<number> {
  return countUnread(member.id);
}

export type Conversation = {
  thread: { id: string; kind: string; title: string | null };
  members: ThreadMember[];
  /** Oldest first. */
  messages: MessageRow[];
  /** Cursor for the page before these, when there is one. */
  before: { createdAt: string; id: string } | null;
  /** Whether this is the newest page, where live messages join. */
  latest: boolean;
  editWindowMinutes: number;
  maxChars: number;
};

export const conversationCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

/** One page of a conversation, newest page by default, and marks it read when it is the newest. */
export async function getConversation(
  member: ChatMember,
  threadId: string,
  cursor: { createdAt: string; id: string } | null,
  now: Date = new Date(),
): Promise<Conversation> {
  const parsedThread = z.uuid().safeParse(threadId);
  if (!parsedThread.success) throw noThread();
  const { thread, members } = await memberThread(member, parsedThread.data);
  const [pageSize, editWindowMinutes, maxChars] = await Promise.all([
    getSetting('chat.messagesPerPage'),
    getSetting('chat.editWindowMinutes'),
    getSetting('chat.maxMessageChars'),
  ]);
  // A cursor that is not one (an edited address) opens the newest page.
  const before = cursor ? (conversationCursorSchema.safeParse(cursor).data ?? null) : null;
  // One extra row says whether an earlier page exists.
  const rows = await listMessages(thread.id, pageSize + 1, before ? { createdAt: new Date(before.createdAt), id: before.id } : null);
  const page = rows.slice(0, pageSize);
  const oldest = page[page.length - 1];
  if (!before) await markThreadRead(thread.id, member.id, now);
  return {
    thread: { id: thread.id, kind: thread.kind, title: thread.title },
    members,
    messages: [...page].reverse(),
    before: rows.length > pageSize && oldest ? { createdAt: oldest.createdAt.toISOString(), id: oldest.id } : null,
    latest: before === null,
    editWindowMinutes,
    maxChars,
  };
}
