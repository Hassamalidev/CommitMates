import { doublePrecision, integer, jsonb, pgTable, primaryKey, smallint, text } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz } from './columns';

/** Conditional-request cache for GitHub REST GETs. ETags are tied to the token, hence the identity in the key. */
export const apiCache = pgTable(
  'api_cache',
  {
    /** `'server'` or `'user:<uuid>'`. */
    tokenIdentity: text('token_identity').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    etag: text('etag'),
    lastModified: text('last_modified'),
    status: smallint('status').notNull(),
    body: jsonb('body'),
    fetchedAt: timestamptz('fetched_at').notNull(),
    expiresAt: timestamptz('expires_at'),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.tokenIdentity, table.method, table.url] })],
).enableRLS();

/** Rate-limit state per identity and resource, read from GitHub's response headers. */
export const githubBudgets = pgTable(
  'github_budgets',
  {
    tokenIdentity: text('token_identity').notNull(),
    /** Value of `x-ratelimit-resource`: core, search, graphql, … */
    resource: text('resource').notNull(),
    limit: integer('limit'),
    remaining: integer('remaining'),
    resetAt: timestamptz('reset_at'),
    lastCallAt: timestamptz('last_call_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tokenIdentity, table.resource] })],
).enableRLS();

/** Token buckets for rate limiting; mutated only by the `take_token` function. */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();
