import { bigint, boolean, index, integer, jsonb, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';

/** Where a secret was found. The value is never stored (CLAUDE.md §2.6, §8 F3). */
export type StoredSecretFinding = { ruleId: string; repo: string; path: string; line: number };

/**
 * A member's own Recruiter-Ready check with the secret scan (CLAUDE.md §7.4). Readable only by
 * that member. Rows belong to the member and are deleted with the account.
 */
export const recruiterReports = pgTable(
  'recruiter_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectGithubId: bigint('subject_github_id', { mode: 'number' }).notNull(),
    score: smallint('score'),
    rules: jsonb('rules').notNull(),
    secretFindings: jsonb('secret_findings').$type<StoredSecretFinding[]>().notNull(),
    /** True when the scan stopped at a cap, a truncated tree or the deadline. */
    secretScanPartial: boolean('secret_scan_partial').notNull().default(false),
    filesScanned: integer('files_scanned').notNull().default(0),
    computedAt: timestamptz('computed_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('recruiter_reports_user_computed_idx').on(table.userId, table.computedAt)],
).enableRLS();

/**
 * How often each short commit message occurs across analyses, so the most common ones can
 * be treated as generic (CLAUDE.md §8 F3). Normalized text and a count only: no person,
 * repository or time is linked to a message.
 */
export const genericMessageCounts = pgTable(
  'generic_message_counts',
  {
    message: text('message').primaryKey(),
    count: integer('count').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('generic_message_counts_count_idx').on(table.count)],
).enableRLS();

/**
 * One Group Fairness Report per run, for the "reports per week" metric (CLAUDE.md §1.7, §7.4).
 * Holds team-level numbers only: no names, accounts or emails of contributors.
 */
export const fairnessReports = pgTable(
  'fairness_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    params: jsonb('params').notNull(),
    result: jsonb('result').notNull(),
    computedAt: timestamptz('computed_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('fairness_reports_computed_idx').on(table.computedAt)],
).enableRLS();

/** One Gap Finder run (CLAUDE.md §7.4): the repository, its peers and the facets compared. Public data only. */
export const gapReports = pgTable(
  'gap_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoGithubId: bigint('repo_github_id', { mode: 'number' }).notNull(),
    peerRepoIds: bigint('peer_repo_ids', { mode: 'number' }).array().notNull(),
    facets: jsonb('facets').notNull(),
    gaps: jsonb('gaps').notNull(),
    computedAt: timestamptz('computed_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('gap_reports_repo_idx').on(table.repoGithubId), index('gap_reports_computed_idx').on(table.computedAt)],
).enableRLS();

/**
 * A member's skills for matching (CLAUDE.md §7.4, §8 F11 "Vectors"). `base` holds the term
 * frequencies from their code (language shares and skill tags); `vector` is the TF-IDF weighting
 * within their university, recomputed for everyone there when a member's base changes, because
 * document frequencies move. `interests` are topics of owned and starred repositories.
 */
export const skillVectors = pgTable(
  'skill_vectors',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    base: jsonb('base').$type<Record<string, number>>().notNull(),
    vector: jsonb('vector').$type<Record<string, number>>().notNull(),
    topTags: text('top_tags').array().notNull(),
    interests: text('interests').array().notNull(),
    clusterLabel: text('cluster_label'),
    computedAt: timestamptz('computed_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('skill_vectors_computed_idx').on(table.computedAt)],
).enableRLS();
