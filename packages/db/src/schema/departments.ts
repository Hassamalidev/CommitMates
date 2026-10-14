import { type AnyPgColumn, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './columns';
import { users } from './identity';
import { universities } from './universities';

/**
 * Departments per university, created by members during onboarding (CLAUDE.md §7.2, §8 F10
 * step 7). A typed name that is close to an existing one (trigram similarity) reuses it, so
 * "CS" spellings converge; moderators can merge the rest (`merged_into_id`).
 */
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('departments_university_normalized_key').on(table.universityId, table.normalizedName),
    index('departments_normalized_trgm_idx').using('gin', table.normalizedName.op('gin_trgm_ops')),
  ],
).enableRLS();

/**
 * Invite links (CLAUDE.md §1.4, §7.2): one code per member and university. A link carries
 * `?ref=<uni-slug>&invite=<code>`; `uses` counts invitees who then verify at that university.
 */
export const invites = pgTable(
  'invites',
  {
    code: text('code').primaryKey(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'cascade' }),
    uses: integer('uses').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('invites_university_creator_key').on(table.universityId, table.createdBy)],
).enableRLS();
