import { sql } from 'drizzle-orm';
import { index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
