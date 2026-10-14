import { boolean, char, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, updatedAt } from './columns';

export const universitySource = pgEnum('university_source', ['hipo', 'admin']);

/**
 * Universities from the Hipo university-domains-list, plus ones admins approve (CLAUDE.md §6.4,
 * §7.2). A university with members is never deleted: `source_missing` marks one the list dropped.
 */
export const universities = pgTable(
  'universities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    country: text('country').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    stateProvince: text('state_province'),
    webPages: text('web_pages').array().notNull(),
    source: universitySource('source').notNull(),
    /** Identity in the Hipo list: name and country code, which the list keeps stable. */
    sourceKey: text('source_key'),
    sourceMissing: boolean('source_missing').notNull().default(false),
    checksum: text('checksum').notNull(),
    /** Verified members; maintained by the verification flow (P3-T04). */
    memberCount: integer('member_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('universities_slug_key').on(table.slug),
    uniqueIndex('universities_source_key_key').on(table.sourceKey),
    index('universities_country_code_idx').on(table.countryCode),
  ],
).enableRLS();

/** Root email domains of each university; `name@cs.uni.edu` matches `uni.edu` by suffix (§6.4). */
export const universityDomains = pgTable(
  'university_domains',
  {
    domain: citext('domain').notNull(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    // A few domains are shared by several universities in the list (§8 F10 "Edge cases").
    uniqueIndex('university_domains_domain_university_key').on(table.domain, table.universityId),
    index('university_domains_university_idx').on(table.universityId),
  ],
).enableRLS();

/** Throwaway email domains rejected during verification (§6.5). */
export const disposableDomains = pgTable('disposable_domains', {
  domain: citext('domain').primaryKey(),
  syncedAt: timestamptz('synced_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();
