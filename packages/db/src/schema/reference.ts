import { boolean, index, jsonb, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

/** One allowlist of a gitleaks rule: matches it describes are not secrets (CLAUDE.md §6.7). */
export type SecretAllowlist = {
  /** `OR` (default): any criterion allows a match; `AND`: all defined criteria must. */
  condition: 'OR' | 'AND';
  /** What the regexes are tested against. */
  regexTarget: 'secret' | 'match' | 'line';
  regexes: string[];
  paths: string[];
  stopwords: string[];
};

/**
 * Secret-detection rules from gitleaks' default configuration (CLAUDE.md §6.7). Patterns are
 * Go regular expressions compiled with RE2; `compiled_ok` is false for any RE2 cannot express.
 */
export const secretRules = pgTable('secret_rules', {
  /** The gitleaks rule id, e.g. `aws-access-token`. */
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  regex: text('regex'),
  /** Lowercased; a file without any of them is not tested against the rule. */
  keywords: text('keywords').array().notNull(),
  entropy: real('entropy'),
  /** Capture group holding the secret; 0 means the first non-empty group, or the whole match. */
  secretGroup: smallint('secret_group').notNull().default(0),
  /** Rules that apply only to matching paths, or that match a path alone. */
  pathRegex: text('path_regex'),
  allowlists: jsonb('allowlists').$type<SecretAllowlist[]>().notNull(),
  compiledOk: boolean('compiled_ok').notNull(),
  checksum: text('checksum').notNull(),
  syncedAt: timestamptz('synced_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();

/** gitleaks' global allowlist: paths, regexes and stopwords that are never secrets, for every rule. */
export const secretGlobalAllowlist = pgTable('secret_global_allowlist', {
  /** Always `global`: a single row, replaced on each sync. */
  id: text('id').primaryKey(),
  allowlist: jsonb('allowlist').$type<SecretAllowlist>().notNull(),
  syncedAt: timestamptz('synced_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();
