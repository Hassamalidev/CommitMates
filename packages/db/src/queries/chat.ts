import { and, asc, count, desc, eq, gte, lt, min, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import {
  blocks,
  connections,
  githubIdentities,
  messageRequests,
  messages,
  notifications,
  profiles,
  threadMembers,
  threads,
  trustScores,
  users,
} from '../schema';

export type ChatParticipant = {
  status: 'active' | 'suspended' | 'hidden_pending_review';
  universityId: string | null;
  verified: boolean;
  ghostMode: boolean;
  createdAt: Date;
};

/** What the request rules need to know about one side of a message request (CLAUDE.md §8 F12). */
export async function getChatParticipant(userId: string, db: DbOrTx = getDb()): Promise<ChatParticipant | null> {
  const [row] = await db
    .select({
      status: users.status,
      universityId: profiles.universityId,
      verifiedAt: profiles.verifiedAt,
      ghostMode: profiles.ghostMode,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;
  return { status: row.status, universityId: row.universityId, verified: row.verifiedAt !== null, ghostMode: row.ghostMode, createdAt: row.createdAt };
}

/**
 * Locks the sender's user row for the rest of the transaction, so two requests sent at once are
 * counted one after the other against the daily limit.
 */
export async function lockSender(userId: string, tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select id from users where id = ${userId} for update`);
}

/** Whether either member has blocked the other. */
export async function isBlockedEitherWay(a: string, b: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ blocker: blocks.blocker })
    .from(blocks)
    .where(or(and(eq(blocks.blocker, a), eq(blocks.blocked, b)), and(eq(blocks.blocker, b), eq(blocks.blocked, a))))
    .limit(1);
  return row !== undefined;
}

/** How many message requests a member has sent since `since`, whatever became of them, and when the first was sent. */
export async function requestsSentSince(userId: string, since: Date, db: DbOrTx = getDb()): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({ value: count(), oldest: min(messageRequests.createdAt) })
    .from(messageRequests)
    .where(and(eq(messageRequests.fromUser, userId), gte(messageRequests.createdAt, since)));
  return { count: row?.value ?? 0, oldest: row?.oldest ?? null };
}

/** The member's nightly trust multiplier, or null before their first trust score (§8 F12 "Trust score"). */
export async function getTrustMultiplier(userId: string, db: DbOrTx = getDb()): Promise<number | null> {
  const [row] = await db.select({ multiplier: trustScores.multiplier }).from(trustScores).where(eq(trustScores.userId, userId));
  return row?.multiplier ?? null;
}

export type NewMessageRequest = {
  fromUser: string;
  toUser: string;
  contextKind: string;
  contextId: string | null;
  icebreakerKey: string | null;
  firstMessage: string;
};

/** Stores a pending request; null when one is already pending from this sender to this person. */
export async function insertMessageRequest(request: NewMessageRequest, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.insert(messageRequests).values(request).onConflictDoNothing().returning({ id: messageRequests.id });
  return row?.id ?? null;
}

/** Marks pending requests from `fromUser` to `toUser` sent before `cutoff` as expired, so a new one can be sent. */
export async function expireStaleRequests(fromUser: string, toUser: string, cutoff: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(messageRequests)
    .set({ status: 'expired' })
    .where(
      and(
        eq(messageRequests.fromUser, fromUser),
        eq(messageRequests.toUser, toUser),
        eq(messageRequests.status, 'pending'),
        lt(messageRequests.createdAt, cutoff),
      ),
    );
}

export type RequestRow = typeof messageRequests.$inferSelect;

/** A request addressed to `toUser`, locked for the rest of the transaction. */
export async function lockIncomingRequest(requestId: string, toUser: string, tx: DbOrTx): Promise<RequestRow | null> {
  const [row] = await tx
    .select()
    .from(messageRequests)
    .where(and(eq(messageRequests.id, requestId), eq(messageRequests.toUser, toUser)))
    .for('update');
  return row ?? null;
}

/** Records the answer to a request. */
export async function setRequestStatus(requestId: string, status: 'accepted' | 'declined' | 'expired', now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.update(messageRequests).set({ status, respondedAt: status === 'expired' ? null : now }).where(eq(messageRequests.id, requestId));
}

/** A pending request the other way round, answered along with this one when it is accepted. */
export async function acceptReverseRequest(fromUser: string, toUser: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(messageRequests)
    .set({ status: 'accepted', respondedAt: now })
    .where(and(eq(messageRequests.fromUser, fromUser), eq(messageRequests.toUser, toUser), eq(messageRequests.status, 'pending')));
}

export type PersonSummary = { userId: string; login: string; name: string | null; avatarUrl: string | null };

export type IncomingRequest = {
  id: string;
  from: PersonSummary;
  contextKind: string;
  contextId: string | null;
  icebreakerKey: string | null;
  firstMessage: string;
  createdAt: Date;
};

/** Pending requests to a member sent since `since`, newest first, with who sent them. */
export async function listIncomingRequests(userId: string, since: Date, db: DbOrTx = getDb()): Promise<IncomingRequest[]> {
  const rows = await db
    .select({
      id: messageRequests.id,
      contextKind: messageRequests.contextKind,
      contextId: messageRequests.contextId,
      icebreakerKey: messageRequests.icebreakerKey,
      firstMessage: messageRequests.firstMessage,
      createdAt: messageRequests.createdAt,
      userId: githubIdentities.userId,
      login: githubIdentities.login,
      name: githubIdentities.name,
      avatarUrl: githubIdentities.avatarUrl,
    })
    .from(messageRequests)
    .innerJoin(githubIdentities, eq(githubIdentities.userId, messageRequests.fromUser))
    .innerJoin(users, eq(users.id, messageRequests.fromUser))
    .where(
      and(
        eq(messageRequests.toUser, userId),
        eq(messageRequests.status, 'pending'),
        gte(messageRequests.createdAt, since),
        eq(users.status, 'active'),
        sql`not exists (select 1 from blocks b where (b.blocker = ${userId} and b.blocked = ${messageRequests.fromUser})
                         or (b.blocker = ${messageRequests.fromUser} and b.blocked = ${userId}))`,
      ),
    )
    .orderBy(desc(messageRequests.createdAt));
  return rows.map(({ userId: fromId, login, name, avatarUrl, ...request }) => ({ ...request, from: { userId: fromId, login, name, avatarUrl } }));
}

export type OutgoingRequest = {
  id: string;
  to: PersonSummary;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: Date;
};

/** Requests a member sent since `since`, newest first. */
export async function listOutgoingRequests(userId: string, since: Date, db: DbOrTx = getDb()): Promise<OutgoingRequest[]> {
  const rows = await db
    .select({
      id: messageRequests.id,
      status: messageRequests.status,
      createdAt: messageRequests.createdAt,
      userId: githubIdentities.userId,
      login: githubIdentities.login,
      name: githubIdentities.name,
      avatarUrl: githubIdentities.avatarUrl,
    })
    .from(messageRequests)
    .innerJoin(githubIdentities, eq(githubIdentities.userId, messageRequests.toUser))
    .where(and(eq(messageRequests.fromUser, userId), gte(messageRequests.createdAt, since)))
    .orderBy(desc(messageRequests.createdAt));
  return rows.map(({ userId: toId, login, name, avatarUrl, ...request }) => ({ ...request, to: { userId: toId, login, name, avatarUrl } }));
}

/** The direct thread two members already share, if any. */
export async function findDirectThread(a: string, b: string, db: DbOrTx = getDb()): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    select t.id from threads t
    join thread_members ma on ma.thread_id = t.id and ma.user_id = ${a}
    join thread_members mb on mb.thread_id = t.id and mb.user_id = ${b}
    where t.kind = 'direct'
    limit 1`);
  return rows[0]?.id ?? null;
}

/** A new thread with its members. */
export async function createThread(
  kind: 'direct' | 'group' | 'squad' | 'swap' | 'adoption',
  memberIds: readonly string[],
  title: string | null,
  db: DbOrTx = getDb(),
): Promise<string> {
  const [thread] = await db.insert(threads).values({ kind, title }).returning({ id: threads.id });
  if (!thread) throw new Error('thread insert returned no row');
  await db.insert(threadMembers).values(memberIds.map((userId) => ({ threadId: thread.id, userId })));
  return thread.id;
}

export type MessageRow = typeof messages.$inferSelect;

/** Adds a message to a thread. */
export async function insertMessage(
  message: { threadId: string; authorUserId: string | null; kind: 'user' | 'system'; body: string; createdAt?: Date },
  db: DbOrTx = getDb(),
): Promise<MessageRow> {
  const [row] = await db.insert(messages).values(message).returning();
  if (!row) throw new Error('message insert returned no row');
  return row;
}

/** Records that two members met through a feature; stored once, in id order. */
export async function addConnection(a: string, b: string, source: 'match' | 'swap' | 'squad' | 'review' | 'adoption' | 'legacy' | 'alumni', db: DbOrTx = getDb()): Promise<void> {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  await db.insert(connections).values({ userA, userB, source }).onConflictDoNothing();
}

export type ThreadMember = PersonSummary & { lastReadAt: Date | null; muted: boolean };

/** Members of a thread with their GitHub identity; empty when the thread does not exist. */
export async function listThreadMembers(threadId: string, db: DbOrTx = getDb()): Promise<ThreadMember[]> {
  return db
    .select({
      userId: threadMembers.userId,
      login: githubIdentities.login,
      name: githubIdentities.name,
      avatarUrl: githubIdentities.avatarUrl,
      lastReadAt: threadMembers.lastReadAt,
      muted: threadMembers.muted,
    })
    .from(threadMembers)
    .innerJoin(githubIdentities, eq(githubIdentities.userId, threadMembers.userId))
    .where(eq(threadMembers.threadId, threadId))
    .orderBy(asc(threadMembers.joinedAt));
}

export async function getThread(threadId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId));
  return row ?? null;
}

/** A page of a thread's messages, newest first, before an optional `(createdAt, id)` cursor. */
export async function listMessages(
  threadId: string,
  limit: number,
  before: { createdAt: Date; id: string } | null,
  db: DbOrTx = getDb(),
): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.threadId, threadId),
        before ? sql`(${messages.createdAt}, ${messages.id}) < (${before.createdAt.toISOString()}::timestamptz, ${before.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
}

export async function getMessage(messageId: string, db: DbOrTx = getDb()): Promise<MessageRow | null> {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
  return row ?? null;
}

/** Replaces a message's body (an edit) or empties it (a deletion). */
export async function updateMessage(messageId: string, change: { body: string; editedAt?: Date; deletedAt?: Date }, db: DbOrTx = getDb()): Promise<MessageRow | null> {
  const [row] = await db.update(messages).set(change).where(eq(messages.id, messageId)).returning();
  return row ?? null;
}

/** Marks a thread read up to `at` for one member. */
export async function markThreadRead(threadId: string, userId: string, at: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(threadMembers)
    .set({ lastReadAt: at })
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)));
}

export async function setThreadMuted(threadId: string, userId: string, muted: boolean, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(threadMembers)
    .set({ muted })
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)))
    .returning({ threadId: threadMembers.threadId });
  return rows.length > 0;
}

/** Removes a member from a thread; false when they were not in it. */
export async function removeThreadMember(threadId: string, userId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .delete(threadMembers)
    .where(and(eq(threadMembers.threadId, threadId), eq(threadMembers.userId, userId)))
    .returning({ threadId: threadMembers.threadId });
  return rows.length > 0;
}

export type ThreadSummary = {
  id: string;
  kind: string;
  title: string | null;
  muted: boolean;
  others: PersonSummary[];
  lastMessage: { body: string; kind: 'user' | 'system'; authorUserId: string | null; deleted: boolean; createdAt: Date } | null;
  unread: number;
};

/**
 * A member's threads, most recent activity first, with the other members, the last message and how
 * many messages from others arrived after the member last read the thread.
 */
export async function listThreadSummaries(userId: string, db: DbOrTx = getDb()): Promise<ThreadSummary[]> {
  const rows = await db.execute<{
    id: string;
    kind: string;
    title: string | null;
    muted: boolean;
    others: PersonSummary[] | null;
    last_body: string | null;
    last_kind: 'user' | 'system' | null;
    last_author: string | null;
    last_deleted: boolean | null;
    last_at: string | null;
    unread: number;
  }>(sql`
    select t.id, t.kind, t.title, me.muted,
           (select json_agg(json_build_object('userId', g.user_id, 'login', g.login, 'name', g.name, 'avatarUrl', g.avatar_url) order by tm.joined_at)
            from thread_members tm join github_identities g on g.user_id = tm.user_id
            where tm.thread_id = t.id and tm.user_id <> ${userId}) as others,
           last.body as last_body, last.kind as last_kind, last.author_user_id as last_author,
           (last.deleted_at is not null) as last_deleted, last.created_at as last_at,
           (select count(*)::int from messages m
            where m.thread_id = t.id and (m.author_user_id is null or m.author_user_id <> ${userId})
              and m.deleted_at is null and (me.last_read_at is null or m.created_at > me.last_read_at)) as unread
    from thread_members me
    join threads t on t.id = me.thread_id
    left join lateral (
      select body, kind, author_user_id, deleted_at, created_at from messages m
      where m.thread_id = t.id order by m.created_at desc, m.id desc limit 1) last on true
    where me.user_id = ${userId}
    order by coalesce(last.created_at, t.created_at) desc, t.id`);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    muted: row.muted,
    others: row.others ?? [],
    lastMessage:
      row.last_at === null || row.last_kind === null
        ? null
        : { body: row.last_body ?? '', kind: row.last_kind, authorUserId: row.last_author, deleted: row.last_deleted ?? false, createdAt: new Date(row.last_at) },
    unread: row.unread,
  }));
}

/** Messages from others a member has not read yet, across their unmuted threads. */
export async function countUnread(userId: string, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ unread: number }>(sql`
    select count(*)::int as unread
    from thread_members me
    join messages m on m.thread_id = me.thread_id
    where me.user_id = ${userId} and not me.muted
      and (m.author_user_id is null or m.author_user_id <> ${userId}) and m.deleted_at is null
      and (me.last_read_at is null or m.created_at > me.last_read_at)`);
  return rows[0]?.unread ?? 0;
}

/** An in-app notification for a member (CLAUDE.md §7.5). */
export async function insertNotification(userId: string, kind: string, data: Record<string, unknown>, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(notifications).values({ userId, kind, data });
}

/** A member's GitHub login, for notifications and system messages. */
export async function getLogin(userId: string, db: DbOrTx = getDb()): Promise<string | null> {
  const [row] = await db.select({ login: githubIdentities.login }).from(githubIdentities).where(eq(githubIdentities.userId, userId));
  return row?.login ?? null;
}
