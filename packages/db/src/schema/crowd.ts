import { sql } from 'drizzle-orm';
import { bigint, boolean, char, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, tsvector, updatedAt } from './columns';
import { users } from './identity';
import { threads } from './social';
import { universities } from './universities';

export const crawlCursorStatus = pgEnum('crawl_cursor_status', ['pending', 'splitting', 'running', 'done']);
export const leaderboardScope = pgEnum('leaderboard_scope', ['university', 'department', 'member']);
export const alumniQuestionStatus = pgEnum('alumni_question_status', ['open', 'answered', 'closed', 'expired']);
export const questionRouteStatus = pgEnum('question_route_status', ['pending', 'answered', 'passed', 'expired']);
export const eventVisibility = pgEnum('event_visibility', ['university', 'country', 'public']);
export const eventStatus = pgEnum('event_status', ['open', 'forming', 'finalized', 'closed']);
export const squadStatus = pgEnum('squad_status', ['proposed', 'final']);
export const squadSwapStatus = pgEnum('squad_swap_status', ['pending', 'done', 'rejected']);
export const fypIdeaStatus = pgEnum('fyp_idea_status', ['open', 'team_forming', 'taken', 'archived']);

const memberRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/**
 * One slice of the country crawl (CLAUDE.md §7.9, §8 F18): a location seed and an account-creation
 * date range small enough for GitHub search's result ceiling. `country_code` groups the seeds of one
 * country; `crawled_at` dates the last finished pass, for `crawler.refreshDays`.
 */
export const crawlCursors = pgTable(
  'crawl_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seed: text('seed').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    createdFrom: date('created_from').notNull(),
    createdTo: date('created_to').notNull(),
    page: integer('page').notNull().default(0),
    totalCount: integer('total_count'),
    status: crawlCursorStatus('status').notNull().default('pending'),
    crawledAt: timestamptz('crawled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('crawl_cursors_slice_key').on(table.seed, table.countryCode, table.createdFrom, table.createdTo),
    index('crawl_cursors_status_idx').on(table.status, table.updatedAt),
  ],
).enableRLS();

/** Logins that asked never to be crawled (§8 F18 "Privacy"); honored within one crawl cycle. */
export const crawlOptouts = pgTable('crawl_optouts', {
  githubLogin: citext('github_login').primaryKey(),
  createdAt: createdAt(),
}).enableRLS();

/**
 * A weekly leaderboard entry (§8 F19). `scope_id` is a university, a department, or (for the opt-in
 * board) a member; `group_id` is what it is ranked within: the country for universities, the
 * university for departments and members.
 */
export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: leaderboardScope('scope').notNull(),
    scopeId: uuid('scope_id').notNull(),
    groupId: text('group_id').notNull(),
    weekStart: date('week_start').notNull(),
    metrics: jsonb('metrics').notNull(),
    score: real('score').notNull(),
    rank: integer('rank').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('leaderboard_snapshots_scope_week_key').on(table.scope, table.scopeId, table.weekStart),
    index('leaderboard_snapshots_board_idx').on(table.scope, table.groupId, table.weekStart),
  ],
).enableRLS();

/** Members who chose to appear on their university's individual leaderboard (§8 F19 step 6). */
export const leaderboardOptins = pgTable('leaderboard_optins', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  optedInAt: timestamptz('opted_in_at').notNull().defaultNow(),
}).enableRLS();

/** A short question to the university's alumni (§8 F20). */
export const alumniQuestions = pgTable(
  'alumni_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    askerUserId: memberRef('asker_user_id'),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    tags: text('tags').array().notNull(),
    anonymous: boolean('anonymous').notNull().default(false),
    status: alumniQuestionStatus('status').notNull().default('open'),
    round: smallint('round').notNull().default(0),
    answeredBy: uuid('answered_by').references(() => users.id, { onDelete: 'set null' }),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    answeredAt: timestamptz('answered_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('alumni_questions_asker_idx').on(table.askerUserId),
    index('alumni_questions_university_status_idx').on(table.universityId, table.status),
    index('alumni_questions_answered_by_idx').on(table.answeredBy),
    index('alumni_questions_thread_idx').on(table.threadId),
  ],
).enableRLS();

/** One alumnus a question was routed to, in one round (§8 F20 "Routing"). */
export const questionRoutes = pgTable(
  'question_routes',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => alumniQuestions.id, { onDelete: 'cascade' }),
    alumniUserId: memberRef('alumni_user_id'),
    round: smallint('round').notNull(),
    routedAt: timestamptz('routed_at').notNull().defaultNow(),
    respondedAt: timestamptz('responded_at'),
    status: questionRouteStatus('status').notNull().default('pending'),
  },
  (table) => [primaryKey({ columns: [table.questionId, table.alumniUserId] }), index('question_routes_alumni_status_idx').on(table.alumniUserId, table.status)],
).enableRLS();

/** A hackathon or team event an organizer runs (§8 F21). */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorUserId: memberRef('creator_user_id'),
    title: text('title').notNull(),
    description: text('description'),
    visibility: eventVisibility('visibility').notNull().default('university'),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'cascade' }),
    countryCode: char('country_code', { length: 2 }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    teamSize: smallint('team_size').notNull(),
    status: eventStatus('status').notNull().default('open'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('events_creator_idx').on(table.creatorUserId),
    index('events_university_idx').on(table.universityId),
    index('events_status_starts_idx').on(table.status, table.startsAt),
  ],
).enableRLS();

/** A member taking part in an event, with when they are free and any group they formed beforehand. */
export const eventParticipants = pgTable(
  'event_participants',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: memberRef('user_id'),
    availability: jsonb('availability'),
    lockedGroupKey: text('locked_group_key'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] }), index('event_participants_user_idx').on(table.userId)],
).enableRLS();

/** One proposed or final team of an event; each formation run is a new version (§8 F21 "Formation"). */
export const squads = pgTable(
  'squads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: squadStatus('status').notNull().default('proposed'),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('squads_event_version_idx').on(table.eventId, table.version), index('squads_thread_idx').on(table.threadId)],
).enableRLS();

export const squadMembers = pgTable(
  'squad_members',
  {
    squadId: uuid('squad_id')
      .notNull()
      .references(() => squads.id, { onDelete: 'cascade' }),
    userId: memberRef('user_id'),
    roleLabel: text('role_label'),
  },
  (table) => [primaryKey({ columns: [table.squadId, table.userId] }), index('squad_members_user_idx').on(table.userId)],
).enableRLS();

/** A participant asking to move to another proposed team (§8 F21 "Review"). */
export const squadSwapRequests = pgTable(
  'squad_swap_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    fromUser: memberRef('from_user'),
    toSquadId: uuid('to_squad_id')
      .notNull()
      .references(() => squads.id, { onDelete: 'cascade' }),
    status: squadSwapStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (table) => [
    index('squad_swap_requests_event_idx').on(table.eventId),
    index('squad_swap_requests_from_idx').on(table.fromUser),
    index('squad_swap_requests_to_squad_idx').on(table.toSquadId),
  ],
).enableRLS();

/** A final-year project idea posted at a university (§8 F22 "Ideas"). */
export const fypIdeas = pgTable(
  'fyp_ideas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    authorUserId: memberRef('author_user_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    keyphrases: text('keyphrases').array().notNull(),
    /** Posted by an approved supervisor of the university. */
    supervisorIdea: boolean('supervisor_idea').notNull().default(false),
    status: fypIdeaStatus('status').notNull().default('open'),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || immutable_array_to_string(keyphrases, ' '))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('fyp_ideas_university_status_idx').on(table.universityId, table.status),
    index('fyp_ideas_author_idx').on(table.authorUserId),
    index('fyp_ideas_thread_idx').on(table.threadId),
    index('fyp_ideas_search_idx').using('gin', table.searchTsv),
  ],
).enableRLS();

/**
 * A past final-year project of a university (§8 F22 "Past projects corpus"): submitted by a senior,
 * or detected in a member's README and waiting for their confirmation. Feeds F9 and F17.
 */
export const fypProjects = pgTable(
  'fyp_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    /** The member who owns the repository, who confirms a detected project. */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    year: smallint('year'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    autoDetected: boolean('auto_detected').notNull().default(false),
    confirmed: boolean('confirmed').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('fyp_projects_university_repo_key').on(table.universityId, table.repoGithubId),
    index('fyp_projects_owner_idx').on(table.ownerUserId),
    index('fyp_projects_submitted_by_idx').on(table.submittedBy),
  ],
).enableRLS();

/** A supervisor of a university and their areas; `approved_at` is null while the application waits (§8 F22). */
export const fypSupervisors = pgTable(
  'fyp_supervisors',
  {
    userId: memberRef('user_id'),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    areas: text('areas').array().notNull(),
    approvedAt: timestamptz('approved_at'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.universityId] }),
    index('fyp_supervisors_university_idx').on(table.universityId),
    index('fyp_supervisors_approved_by_idx').on(table.approvedBy),
  ],
).enableRLS();

/** A member's interest in joining an idea's team, with a short message (§8 F22 "Ideas"). */
export const fypInterest = pgTable(
  'fyp_interest',
  {
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => fypIdeas.id, { onDelete: 'cascade' }),
    userId: memberRef('user_id'),
    message: text('message').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.ideaId, table.userId] }), index('fyp_interest_user_idx').on(table.userId)],
).enableRLS();
