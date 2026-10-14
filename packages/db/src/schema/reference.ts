import { boolean, index, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz } from './columns';

export const pathPatternKind = pgEnum('path_pattern_kind', ['vendored', 'documentation']);

/** Programming languages from GitHub Linguist: colors for charts and companions, extensions for file typing. */
export const languages = pgTable('languages', {
  name: text('name').primaryKey(),
  color: text('color'),
  extensions: text('extensions').array().notNull(),
  aliases: text('aliases').array().notNull(),
  syncedAt: timestamptz('synced_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();

/** Linguist's vendored and documentation path rules. `compiled_ok` is false when RE2 cannot express the Ruby regex. */
export const pathPatterns = pgTable(
  'path_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: pathPatternKind('kind').notNull(),
    pattern: text('pattern').notNull(),
    compiledOk: boolean('compiled_ok').notNull(),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('path_patterns_kind_pattern_key').on(table.kind, table.pattern)],
).enableRLS();

/**
 * GitHub topics from github/explore: display names, aliases and related topics. The
 * source of every tag normalization and of the taxonomy engine's alias seeds.
 */
export const topics = pgTable(
  'topics',
  {
    slug: text('slug').primaryKey(),
    displayName: text('display_name').notNull(),
    aliases: text('aliases').array().notNull(),
    related: text('related').array().notNull(),
    /** Git blob sha of the topic's source file; only changed files are fetched again. */
    blobSha: text('blob_sha').notNull(),
    syncedAt: timestamptz('synced_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('topics_aliases_idx').using('gin', table.aliases)],
).enableRLS();

/** Registry metadata of a package and the tags derived from it (CLAUDE.md §6.6). No vocabulary is hand-written. */
export const packageMeta = pgTable(
  'package_meta',
  {
    ecosystem: text('ecosystem').notNull(),
    name: text('name').notNull(),
    keywords: text('keywords').array().notNull(),
    classifiers: text('classifiers').array().notNull(),
    repoFullName: text('repo_full_name'),
    ghTopics: text('gh_topics').array().notNull(),
    derivedTags: text('derived_tags').array().notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.ecosystem, table.name] }),
    index('package_meta_expires_idx').on(table.expiresAt),
    index('package_meta_tags_idx').using('gin', table.derivedTags),
  ],
).enableRLS();

/** One row per registry; locked `for update` so only one request is in flight and calls are spaced. */
export const registryPacing = pgTable('registry_pacing', {
  registry: text('registry').primaryKey(),
  lastCallAt: timestamptz('last_call_at'),
  createdAt: createdAt(),
}).enableRLS();
