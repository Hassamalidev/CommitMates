import { sql } from 'drizzle-orm';
import { boolean, check, date, index, jsonb, pgEnum, pgTable, primaryKey, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';

export const matchMode = pgEnum('match_mode', ['study', 'teammate', 'explore']);
export const suggestionAction = pgEnum('suggestion_action', ['liked', 'skipped', 'requested']);
export const connectionSource = pgEnum('connection_source', ['match', 'swap', 'squad', 'review', 'adoption', 'legacy', 'alumni']);
export const messageRequestStatus = pgEnum('message_request_status', ['pending', 'accepted', 'declined', 'expired']);
export const threadKind = pgEnum('thread_kind', ['direct', 'group', 'squad', 'swap', 'adoption']);
export const messageKind = pgEnum('message_kind', ['user', 'system']);
export const reportReason = pgEnum('report_reason', ['spam', 'harassment', 'impersonation', 'inappropriate', 'other']);
export const reportStatus = pgEnum('report_status', ['open', 'actioned', 'dismissed']);

const memberRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** One day's deck entry for a member (CLAUDE.md §7.6, §8 F11 "Deck"). */
export const matchSuggestions = pgTable(
  'match_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: memberRef('user_id'),
    candidateUserId: memberRef('candidate_user_id'),
    mode: matchMode('mode').notNull(),
    score: real('score').notNull(),
    components: jsonb('components').notNull(),
    explanationKeys: jsonb('explanation_keys').notNull(),
    shownOn: date('shown_on', { mode: 'string' }).notNull(),
    action: suggestionAction('action'),
    actedAt: timestamptz('acted_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('match_suggestions_user_candidate_day_key').on(table.userId, table.candidateUserId, table.shownOn),
    index('match_suggestions_user_day_idx').on(table.userId, table.shownOn),
    index('match_suggestions_candidate_idx').on(table.candidateUserId),
  ],
).enableRLS();

/** Two members who met through a feature, stored once with `user_a < user_b`. */
export const connections = pgTable(
  'connections',
  {
    userA: memberRef('user_a'),
    userB: memberRef('user_b'),
    source: connectionSource('source').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userA, table.userB] }),
    index('connections_user_b_idx').on(table.userB),
    check('connections_ordered', sql`${table.userA} < ${table.userB}`),
  ],
).enableRLS();

/** A first message waiting for consent (CLAUDE.md §8 F12 "Message requests"). */
export const messageRequests = pgTable(
  'message_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUser: memberRef('from_user'),
    toUser: memberRef('to_user'),
    contextKind: text('context_kind').notNull(),
    contextId: text('context_id'),
    icebreakerKey: text('icebreaker_key'),
    firstMessage: text('first_message').notNull(),
    status: messageRequestStatus('status').notNull().default('pending'),
    respondedAt: timestamptz('responded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('message_requests_pending_pair_key').on(table.fromUser, table.toUser).where(sql`${table.status} = 'pending'`),
    index('message_requests_to_status_idx').on(table.toUser, table.status),
    index('message_requests_from_created_idx').on(table.fromUser, table.createdAt),
  ],
).enableRLS();

export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: threadKind('kind').notNull(),
  title: text('title'),
  createdAt: createdAt(),
}).enableRLS();

/** Who is in a thread. Members read their own rows through Supabase Realtime (§5.9). */
export const threadMembers = pgTable(
  'thread_members',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: memberRef('user_id'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    lastReadAt: timestamptz('last_read_at'),
    muted: boolean('muted').notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.userId] }), index('thread_members_user_idx').on(table.userId)],
).enableRLS();

/**
 * Chat messages (§8 F12). `author_user_id` is null for system messages, and when an author's
 * account is deleted their messages are replaced by one system message (§5.12).
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: messageKind('kind').notNull().default('user'),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: timestamptz('edited_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [index('messages_thread_created_idx').on(table.threadId, table.createdAt), index('messages_author_idx').on(table.authorUserId)],
).enableRLS();

/** A member who must not be contacted by, or shown to, another (§8 F12). */
export const blocks = pgTable(
  'blocks',
  {
    blocker: memberRef('blocker'),
    blocked: memberRef('blocked'),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.blocker, table.blocked] }), index('blocks_blocked_idx').on(table.blocked)],
).enableRLS();

/** A member's report about another (§8 F12 "Reports and auto-hide"). */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // A report stays when its author deletes their account; it is still evidence.
    reporter: uuid('reporter').references(() => users.id, { onDelete: 'set null' }),
    targetUser: memberRef('target_user'),
    targetMessage: uuid('target_message').references(() => messages.id, { onDelete: 'set null' }),
    reason: reportReason('reason').notNull(),
    details: text('details'),
    status: reportStatus('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('reports_target_status_idx').on(table.targetUser, table.status),
    index('reports_reporter_idx').on(table.reporter),
    index('reports_status_created_idx').on(table.status, table.createdAt),
  ],
).enableRLS();

/** Nightly trust score and the multiplier on daily new-chat limits (§8 F12 "Trust score"). */
export const trustScores = pgTable('trust_scores', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  score: real('score').notNull(),
  multiplier: real('multiplier').notNull(),
  components: jsonb('components').notNull(),
  computedAt: timestamptz('computed_at').notNull(),
}).enableRLS();
