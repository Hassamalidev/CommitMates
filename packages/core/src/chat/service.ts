import { countLinks } from '@commitmates/algorithms';
import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  ValidationError,
  expireStaleRequests,
  getChatParticipant,
  getDb,
  getLogin,
  getSetting,
  getTrustMultiplier,
  insertMessageRequest,
  insertNotification,
  isBlockedEitherWay,
  lockSender,
  requestsSentSince,
  type DbOrTx,
} from '@commitmates/db';

import { messageRequestSchema, type MessageRequestInput } from './schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_SECOND = 1000; // allowed-literal: unit conversion
/** Before the first nightly trust score, a member gets the base limit. */
const NEUTRAL_MULTIPLIER = 1;

/** The same answer for every reason a person cannot be reached, so nothing about them leaks. */
const unreachable = () => new ForbiddenError('chat.unreachable', "You can't send a request to this person right now.");

export type RequestRules = {
  minChars: number;
  maxChars: number;
  newAccountDays: number;
  maxLinks: number;
  baseLimit: number;
  requestTtlDays: number;
};

/**
 * The settings the request rules read. Loaded before the transaction opens, so a transaction never
 * waits for a pool connection while it holds the sender's lock.
 */
export async function loadRequestRules(): Promise<RequestRules> {
  const [minChars, maxChars, newAccountDays, maxLinks, baseLimit, requestTtlDays] = await Promise.all([
    getSetting('chat.minFirstMessageChars'),
    getSetting('chat.maxMessageChars'),
    getSetting('chat.newAccountDays'),
    getSetting('chat.maxLinksNewAccount'),
    getSetting('chat.newThreadsPerDay.base'),
    getSetting('chat.requestTtlDays'),
  ]);
  return { minChars, maxChars, newAccountDays, maxLinks, baseLimit, requestTtlDays };
}

export type MessageRules = Pick<RequestRules, 'maxChars' | 'newAccountDays' | 'maxLinks'>;

/**
 * Checks any message body (CLAUDE.md §8 F12 "Messages"): not empty, not over `chat.maxMessageChars`,
 * and at most `chat.maxLinksNewAccount` links from accounts younger than `chat.newAccountDays`.
 */
export function checkMessageBody(message: string, senderCreatedAt: Date, now: Date, rules: MessageRules): void {
  const { maxChars, newAccountDays, maxLinks } = rules;
  if (message.length === 0) throw new ValidationError('chat.message_empty', 'Write a message first.', { field: 'message' });
  if (message.length > maxChars) {
    throw new ValidationError('chat.message_long', `Messages can be up to ${maxChars} characters.`, { field: 'message' });
  }
  const isNew = now.getTime() - senderCreatedAt.getTime() < newAccountDays * MS_PER_DAY;
  if (isNew && countLinks(message) > maxLinks) {
    throw new ValidationError(
      'chat.too_many_links',
      maxLinks === 1 ? 'New accounts can include 1 link per message.' : `New accounts can include ${maxLinks} links per message.`,
      { field: 'message' },
    );
  }
}

/**
 * Checks a first message (§8 F12 "Message requests" step 1): with an icebreaker the template says
 * enough; without one it must be at least `chat.minFirstMessageChars` long, so it says why.
 */
function checkFirstMessage(message: string, icebreaker: boolean, senderCreatedAt: Date, now: Date, rules: RequestRules): void {
  if (!icebreaker && message.length < rules.minChars) {
    throw new ValidationError('chat.first_message_short', `Say a little about why you'd like to talk: at least ${rules.minChars} characters.`, {
      field: 'message',
    });
  }
  checkMessageBody(message, senderCreatedAt, now, rules);
}

/**
 * Stores a message request inside `tx` (CLAUDE.md §8 F12 "Message requests" steps 1–3). Both members
 * are verified, active and at the same university; neither has blocked the other; the recipient is
 * not in ghost mode; one pending request per direction; and the sender stays within
 * `round(chat.newThreadsPerDay.base × trust multiplier)` requests in the last 24 hours.
 */
export async function createRequestInTx(
  tx: DbOrTx,
  fromUserId: string,
  raw: MessageRequestInput,
  now: Date,
  rules: RequestRules,
): Promise<string> {
  const input = messageRequestSchema.parse(raw);
  if (input.toUserId === fromUserId) throw new ValidationError('chat.self', "You can't send a request to yourself.");
  const [sender, recipient] = await Promise.all([getChatParticipant(fromUserId, tx), getChatParticipant(input.toUserId, tx)]);
  if (!sender?.verified || sender.status !== 'active' || sender.universityId === null) {
    throw new ForbiddenError('chat.sender_not_verified', 'Verify your university to send requests.');
  }
  if (!recipient?.verified || recipient.status !== 'active' || recipient.ghostMode || recipient.universityId !== sender.universityId) {
    throw unreachable();
  }
  checkFirstMessage(input.message, input.icebreakerKey !== null, sender.createdAt, now, rules);

  await lockSender(fromUserId, tx);
  if (await isBlockedEitherWay(fromUserId, input.toUserId, tx)) throw unreachable();
  // An unanswered request older than `chat.requestTtlDays` has expired and no longer blocks a new one.
  await expireStaleRequests(fromUserId, input.toUserId, new Date(now.getTime() - rules.requestTtlDays * MS_PER_DAY), tx);
  const [multiplier, sent] = await Promise.all([
    getTrustMultiplier(fromUserId, tx),
    requestsSentSince(fromUserId, new Date(now.getTime() - MS_PER_DAY), tx),
  ]);
  const limit = Math.round(rules.baseLimit * (multiplier ?? NEUTRAL_MULTIPLIER));
  if (sent.count >= limit) {
    const freeAt = (sent.oldest?.getTime() ?? now.getTime()) + MS_PER_DAY;
    throw new RateLimitedError(
      'chat.daily_limit',
      limit === 1 ? 'You can send 1 new request a day. Try again tomorrow.' : `You can send ${limit} new requests a day. Try again tomorrow.`,
      Math.max(1, Math.ceil((freeAt - now.getTime()) / MS_PER_SECOND)),
    );
  }
  const id = await insertMessageRequest(
    {
      fromUser: fromUserId,
      toUser: input.toUserId,
      contextKind: input.contextKind,
      contextId: input.contextId,
      icebreakerKey: input.icebreakerKey,
      firstMessage: input.message,
    },
    tx,
  );
  if (id === null) throw new ConflictError('chat.request_pending', 'You already have a request waiting with this person.');
  await insertNotification(input.toUserId, 'chat_request', { login: await getLogin(fromUserId, tx), context: input.contextKind }, tx);
  return id;
}

/** Sends a message request in its own transaction. */
export async function createRequest(fromUserId: string, input: MessageRequestInput, now: Date = new Date()): Promise<string> {
  const rules = await loadRequestRules();
  return getDb().transaction((tx) => createRequestInTx(tx, fromUserId, input, now, rules));
}
