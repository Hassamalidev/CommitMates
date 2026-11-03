import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, tsvector } from './columns';

export const ghAccountType = pgEnum('gh_account_type', ['User', 'Organization', 'Bot']);

/**
 * Public GitHub profile fields. Rows about people who are not members carry an
 * `expires_at` and are purged after `privacy.nonUserRawTtlHours` (CLAUDE.md §5.12, class C).
 */
export const ghUsers = pgTable(
  'gh_users',
  {
    githubId: bigint('github_id', { mode: 'number' }).primaryKey(),
    login: citext('login').notNull(),
    type: ghAccountType('type').notNull().default('User'),
    name: text('name'),
    locationRaw: text('location_raw'),
    /** Normalized location string, the key into `geocode_cache`. */
    geocodeKey: text('geocode_key'),
    company: text('company'),
    blog: text('blog'),
    bio: text('bio'),
    followers: integer('followers').notNull().default(0),
    following: integer('following').notNull().default(0),
    publicRepos: integer('public_repos').notNull().default(0),
    ghCreatedAt: timestamptz('gh_created_at'),
    isMember: boolean('is_member').notNull().default(false),
    inCountryIndex: boolean('in_country_index').notNull().default(false),
    /** The country whose index found this account (§8 F18), for the country scope of search. */
    indexCountryCode: char('index_country_code', { length: 2 }),
    fetchedAt: timestamptz('fetched_at').notNull(),
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('gh_users_login_key').on(table.login),
    index('gh_users_expires_idx').on(table.expiresAt),
    index('gh_users_geocode_idx').on(table.geocodeKey),
    index('gh_users_country_index_idx').on(table.indexCountryCode).where(sql`${table.inCountryIndex}`),
  ],
).enableRLS();

/** Public repository metadata. Expires with its owner's row unless the owner is a member. */
export const ghRepos = pgTable(
  'gh_repos',
  {
    githubId: bigint('github_id', { mode: 'number' }).primaryKey(),
    ownerGithubId: bigint('owner_github_id', { mode: 'number' }).notNull(),
    fullName: citext('full_name').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    homepage: text('homepage'),
    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
    primaryLanguage: text('primary_language'),
    /** `{ language: bytes }` */
    languages: jsonb('languages').$type<Record<string, number>>().notNull().default({}),
    stars: integer('stars').notNull().default(0),
    forks: integer('forks').notNull().default(0),
    openIssues: integer('open_issues').notNull().default(0),
    licenseSpdx: text('license_spdx'),
    isFork: boolean('is_fork').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    /** `null` until a README lookup has been made. */
    hasReadme: boolean('has_readme'),
    readmeChars: integer('readme_chars'),
    readmeHeadings: text('readme_headings').array().notNull().default(sql`'{}'::text[]`),
    unfinishedScore: real('unfinished_score'),
    defaultBranch: text('default_branch'),
    sizeKb: integer('size_kb'),
    commitCountEst: integer('commit_count_est'),
    releaseCount: integer('release_count'),
    ghCreatedAt: timestamptz('gh_created_at'),
    pushedAt: timestamptz('pushed_at'),
    fetchedAt: timestamptz('fetched_at').notNull(),
    expiresAt: timestamptz('expires_at'),
    /** Generated in SQL from name, description, topics and README headings. */
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || immutable_array_to_string(topics, ' ') || ' ' || immutable_array_to_string(readme_headings, ' '))`,
    ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('gh_repos_full_name_key').on(table.fullName),
    index('gh_repos_owner_idx').on(table.ownerGithubId),
    index('gh_repos_pushed_idx').on(table.pushedAt),
    index('gh_repos_expires_idx').on(table.expiresAt),
    index('gh_repos_search_idx').using('gin', table.searchTsv),
    index('gh_repos_full_name_trgm_idx').using('gin', sql`(${table.fullName}::text) gin_trgm_ops`),
  ],
).enableRLS();

/** Manifest files found in a repository root, with the blob sha that was parsed. */
export const repoManifests = pgTable(
  'repo_manifests',
  {
    repoGithubId: bigint('repo_github_id', { mode: 'number' })
      .notNull()
      .references(() => ghRepos.githubId, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    ecosystem: text('ecosystem').notNull(),
    blobSha: text('blob_sha').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.repoGithubId, table.path] })],
).enableRLS();

export const repoDependencies = pgTable(
  'repo_dependencies',
  {
    repoGithubId: bigint('repo_github_id', { mode: 'number' })
      .notNull()
      .references(() => ghRepos.githubId, { onDelete: 'cascade' }),
    ecosystem: text('ecosystem').notNull(),
    packageName: text('package_name').notNull(),
    isDev: boolean('is_dev').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.repoGithubId, table.ecosystem, table.packageName] }),
    index('repo_dependencies_package_idx').on(table.ecosystem, table.packageName),
  ],
).enableRLS();

/** Computed results of the day-one tools, keyed by kind, subject and parameters (CLAUDE.md §5.8). */
export const analysisCache = pgTable(
  'analysis_cache',
  {
    kind: text('kind').notNull(),
    subjectKey: text('subject_key').notNull(),
    paramsHash: text('params_hash').notNull(),
    result: jsonb('result').notNull(),
    /** False for results about people who have not signed up; those are purged on the short TTL. */
    isMemberSubject: boolean('is_member_subject').notNull().default(false),
    computedAt: timestamptz('computed_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.subjectKey, table.paramsHash] }),
    index('analysis_cache_expires_idx').on(table.expiresAt),
  ],
).enableRLS();

/**
 * Top-level structure features of a repository for the Gap Finder (CLAUDE.md §7.3, §8 F5):
 * `dir:<name>`, `file:<name>` (lowercased) and `dir:.github/workflows`. Deleted with the repository row.
 */
export const repoPaths = pgTable(
  'repo_paths',
  {
    repoGithubId: bigint('repo_github_id', { mode: 'number' })
      .notNull()
      .references(() => ghRepos.githubId, { onDelete: 'cascade' }),
    pathFeature: text('path_feature').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.repoGithubId, table.pathFeature] })],
).enableRLS();
