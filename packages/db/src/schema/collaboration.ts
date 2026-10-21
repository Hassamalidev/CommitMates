import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';
import { universities } from './universities';

export const listingStatus = pgEnum('listing_status', ['listed', 'adopted', 'withdrawn']);
export const adoptionStatus = pgEnum('adoption_status', ['requested', 'active', 'revived', 'dropped']);
export const reviewRequestStatus = pgEnum('review_request_status', [
  'open',
  'claimed',
  'submitted',
  'settled_helpful',
  'settled_unhelpful',
  'expired',
  'disputed',
]);
export const reviewRating = pgEnum('review_rating', ['helpful', 'unhelpful']);
export const ledgerReason = pgEnum('ledger_reason', ['starter', 'escrow', 'release', 'refund', 'admin_adjust']);
export const swapProposalStatus = pgEnum('swap_proposal_status', ['proposed', 'accepted', 'declined', 'expired']);
export const swapResponse = pgEnum('swap_response', ['accept', 'decline']);
export const legacySource = pgEnum('legacy_source', ['showcase', 'fyp']);

const memberRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** A member's own inactive repository, put up for adoption at their university (CLAUDE.md §7.8, §8 F14). */
export const graveyardListings = pgTable(
  'graveyard_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    ownerUserId: memberRef('owner_user_id'),
    status: listingStatus('status').notNull().default('listed'),
    note: text('note'),
    listedAt: timestamptz('listed_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One listing per repository that is still listed or adopted.
    uniqueIndex('graveyard_listings_open_repo_key').on(table.repoGithubId).where(sql`${table.status} <> 'withdrawn'`),
    index('graveyard_listings_owner_idx').on(table.ownerUserId),
    index('graveyard_listings_status_idx').on(table.status),
  ],
).enableRLS();

/** Private weekly suggestions of a member's own repositories to list (§8 F14 "Private suggestions"). */
export const listingSuggestions = pgTable(
  'listing_suggestions',
  {
    ownerUserId: memberRef('owner_user_id'),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    suggestedAt: timestamptz('suggested_at').notNull(),
    dismissedAt: timestamptz('dismissed_at'),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.ownerUserId, table.repoGithubId] })],
).enableRLS();

/** A member adopting a repository, from a listing or from the Graveyard search (§8 F7, F14). */
export const adoptions = pgTable(
  'adoptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').references(() => graveyardListings.id, { onDelete: 'set null' }),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    adopterUserId: memberRef('adopter_user_id'),
    forkFullName: citext('fork_full_name'),
    status: adoptionStatus('status').notNull().default('requested'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** When the adoption became active: the owner accepted, or the adopter's fork was found. */
    activatedAt: timestamptz('activated_at'),
    revivedAt: timestamptz('revived_at'),
  },
  (table) => [
    index('adoptions_adopter_idx').on(table.adopterUserId),
    index('adoptions_listing_idx').on(table.listingId),
    index('adoptions_status_idx').on(table.status),
  ],
).enableRLS();

/** A pull request offered for review in exchange for a credit (§8 F15). */
export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorUserId: memberRef('author_user_id'),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    prUrl: text('pr_url').notNull(),
    repoFullName: citext('repo_full_name').notNull(),
    prNumber: integer('pr_number').notNull(),
    languages: text('languages').array().notNull(),
    status: reviewRequestStatus('status').notNull().default('open'),
    claimedBy: uuid('claimed_by').references(() => users.id, { onDelete: 'set null' }),
    claimedAt: timestamptz('claimed_at'),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('review_requests_university_status_idx').on(table.universityId, table.status),
    index('review_requests_author_idx').on(table.authorUserId),
    index('review_requests_claimed_by_idx').on(table.claimedBy),
    index('review_requests_expires_idx').on(table.expiresAt),
  ],
).enableRLS();

/** The review a claimer submitted on GitHub, as verified through the API, and its rating (§8 F15). */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .unique()
      .references(() => reviewRequests.id, { onDelete: 'cascade' }),
    reviewerUserId: memberRef('reviewer_user_id'),
    ghReviewIds: bigint('gh_review_ids', { mode: 'number' }).array().notNull(),
    lineCommentCount: integer('line_comment_count').notNull(),
    verifiedAt: timestamptz('verified_at').notNull(),
    rating: reviewRating('rating'),
    ratedAt: timestamptz('rated_at'),
    createdAt: createdAt(),
  },
  (table) => [index('reviews_reviewer_idx').on(table.reviewerUserId)],
).enableRLS();

/**
 * Review credits, append-only (§8 F15 "Credits"): a trigger refuses updates and deletes while the
 * member exists, so only account deletion (a cascade) removes rows. `request_id` carries no foreign
 * key on purpose: an `on delete` action would be an update.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: memberRef('user_id'),
    delta: integer('delta').notNull(),
    reason: ledgerReason('reason').notNull(),
    requestId: uuid('request_id'),
    createdAt: createdAt(),
  },
  (table) => [index('credit_ledger_user_idx').on(table.userId), index('credit_ledger_request_idx').on(table.requestId)],
).enableRLS();

/** One row per member, locked `for update` around ledger writes so balances are checked in turn. */
export const ledgerLocks = pgTable('ledger_locks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
}).enableRLS();

/** A tag a member can teach: verified from their code, or self-declared (§8 F16). */
export const swapOffers = pgTable(
  'swap_offers',
  {
    userId: memberRef('user_id'),
    tag: text('tag').notNull(),
    level: real('level').notNull(),
    verified: boolean('verified').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tag] }), index('swap_offers_tag_idx').on(table.tag)],
).enableRLS();

/** A tag a member wants to learn, with how much (§8 F16). */
export const swapWants = pgTable(
  'swap_wants',
  {
    userId: memberRef('user_id'),
    tag: text('tag').notNull(),
    priority: smallint('priority').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.tag] }), index('swap_wants_tag_idx').on(table.tag)],
).enableRLS();

/** A 2- or 3-member swap cycle proposed nightly (§8 F16 "Proposal generation"). */
export const swapProposals = pgTable(
  'swap_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    members: uuid('members').array().notNull(),
    edges: jsonb('edges').$type<{ from: string; to: string; tag: string }[]>().notNull(),
    quality: real('quality').notNull(),
    status: swapProposalStatus('status').notNull().default('proposed'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    index('swap_proposals_status_idx').on(table.status),
    // Finds a member's proposals: `members @> array[id]`.
    index('swap_proposals_members_idx').using('gin', table.members),
  ],
).enableRLS();

/** Each member's answer to a swap proposal. */
export const swapResponses = pgTable(
  'swap_responses',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => swapProposals.id, { onDelete: 'cascade' }),
    userId: memberRef('user_id'),
    response: swapResponse('response').notNull(),
    respondedAt: timestamptz('responded_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.userId] }), index('swap_responses_user_idx').on(table.userId)],
).enableRLS();

/** A senior's or alumnus' project in their university's library (§8 F17). */
export const legacyEntries = pgTable(
  'legacy_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    ownerUserId: memberRef('owner_user_id'),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    source: legacySource('source').notNull(),
    gradYear: smallint('grad_year'),
    tags: text('tags').array().notNull(),
    blurb: text('blurb'),
    acceptsQuestions: boolean('accepts_questions').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('legacy_entries_owner_repo_key').on(table.ownerUserId, table.repoGithubId),
    index('legacy_entries_university_idx').on(table.universityId),
    index('legacy_entries_tags_idx').using('gin', table.tags),
  ],
).enableRLS();

/**
 * Merged pull requests of verified members to public repositories, refreshed weekly, for the
 * Open-Source Starter's "seniors contributed here" panel (§8 F8 step 5).
 */
export const ossMemberContribs = pgTable(
  'oss_member_contribs',
  {
    userId: memberRef('user_id'),
    repoFullName: citext('repo_full_name').notNull(),
    mergedPrs: integer('merged_prs').notNull(),
    lastMergedAt: timestamptz('last_merged_at'),
    refreshedAt: timestamptz('refreshed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoFullName] }), index('oss_member_contribs_repo_idx').on(table.repoFullName)],
).enableRLS();
