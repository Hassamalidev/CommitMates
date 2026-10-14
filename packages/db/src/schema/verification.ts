import { sql } from 'drizzle-orm';
import { char, index, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';
import { universities } from './universities';

/**
 * University email verification (CLAUDE.md §7.2, §8 F10 steps 2–4). Only the code's hash is
 * stored. The address is kept only until verification succeeds, then set to null; the
 * domain stays as the record of how the member was verified.
 */
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: citext('email'),
    domain: text('domain').notNull(),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'set null' }),
    codeHash: text('code_hash'),
    expiresAt: timestamptz('expires_at'),
    attempts: smallint('attempts').notNull().default(0),
    sendsToday: smallint('sends_today').notNull().default(0),
    lastSentAt: timestamptz('last_sent_at'),
    verifiedAt: timestamptz('verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One open verification per member at a time.
    uniqueIndex('email_verifications_pending_user_key').on(table.userId).where(sql`${table.verifiedAt} is null`),
    index('email_verifications_user_idx').on(table.userId),
    index('email_verifications_university_idx').on(table.universityId),
  ],
).enableRLS();

export const universityRequestStatus = pgEnum('university_request_status', ['pending', 'approved', 'rejected']);

/**
 * A member asks for a domain the university list does not have (CLAUDE.md §7.2, §8 F10 step 6).
 * Reviewed by an admin, or by a moderator of the university the domain is added to.
 */
export const universityRequests = pgTable(
  'university_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domain: citext('domain').notNull(),
    proposedName: text('proposed_name').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    status: universityRequestStatus('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamptz('reviewed_at'),
    /** The university the domain was added to, once approved. */
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One open request per member and domain.
    uniqueIndex('university_requests_pending_key').on(table.userId, table.domain).where(sql`${table.status} = 'pending'`),
    index('university_requests_status_idx').on(table.status, table.createdAt),
    index('university_requests_user_idx').on(table.userId),
  ],
).enableRLS();
