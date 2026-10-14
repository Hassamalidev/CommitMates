import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';

export const geocodeStatus = pgEnum('geocode_status', ['pending', 'resolved', 'unresolvable']);

/** Anonymous aggregates. `subject_hash` is salted, so a sample cannot be linked to a person (CLAUDE.md §5.12). */
export const metricSamples = pgTable(
  'metric_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metricKey: text('metric_key').notNull(),
    value: doublePrecision('value').notNull(),
    subjectHash: text('subject_hash').notNull(),
    saltPeriod: integer('salt_period').notNull(),
    recordedOn: date('recorded_on', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('metric_samples_dedupe_key').on(table.metricKey, table.subjectHash, table.saltPeriod),
    index('metric_samples_metric_day_idx').on(table.metricKey, table.recordedOn),
  ],
).enableRLS();

export const saltKind = pgEnum('salt_kind', ['ip', 'aggregate']);

/**
 * Random salts that make hashes unlinkable once deleted. `ip` salts last one day
 * (rate-limit keys); `aggregate` salts last `privacy.aggregateSaltRotationDays`.
 */
export const salts = pgTable(
  'salts',
  {
    kind: saltKind('kind').notNull(),
    period: integer('period').notNull(),
    salt: bytea('salt').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.period] })],
).enableRLS();

export const geocodeCache = pgTable(
  'geocode_cache',
  {
    queryNorm: text('query_norm').primaryKey(),
    status: geocodeStatus('status').notNull().default('pending'),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    city: text('city'),
    countryCode: text('country_code'),
    timezone: text('timezone'),
    confidence: real('confidence'),
    provider: text('provider'),
    fetchedAt: timestamptz('fetched_at'),
    createdAt: createdAt(),
  },
  (table) => [index('geocode_cache_pending_idx').on(table.createdAt).where(sql`${table.status} = 'pending'`)],
).enableRLS();

/** Single row; locked `for update` so the whole app calls the geocoder at most once per interval. */
export const geocoderLock = pgTable(
  'geocoder_lock',
  {
    id: smallint('id').primaryKey(),
    lastCallAt: timestamptz('last_call_at'),
    createdAt: createdAt(),
  },
  (table) => [check('geocoder_lock_single_row', sql`${table.id} = 1`)],
).enableRLS();

export const sourceSnapshots = pgTable('source_snapshots', {
  source: text('source').primaryKey(),
  version: text('version'),
  checksum: text('checksum'),
  itemCount: integer('item_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  fetchedAt: timestamptz('fetched_at'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/** `actor_user_id` has no foreign key: the log outlives the account (CLAUDE.md §5.12). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_log_target_idx').on(table.targetType, table.targetId),
    index('audit_log_created_idx').on(table.createdAt.desc()),
  ],
).enableRLS();

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    data: jsonb('data').notNull().default({}),
    readAt: timestamptz('read_at'),
    emailedAt: timestamptz('emailed_at'),
    createdAt: createdAt(),
  },
  (table) => [index('notifications_user_read_idx').on(table.userId, table.readAt)],
).enableRLS();

export const notificationPrefs = pgTable('notification_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailDigest: boolean('email_digest').notNull().default(true),
  kindsMuted: text('kinds_muted').array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    page: text('page').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('feedback_user_idx').on(table.userId)],
).enableRLS();

/** One row per day-one tool run, for the tool-conversion metric. No raw IP is stored. */
export const toolSessions = pgTable(
  'tool_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tool: text('tool').notNull(),
    ipHashDay: text('ip_hash_day').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    convertedUserId: uuid('converted_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('tool_sessions_tool_created_idx').on(table.tool, table.createdAt),
    index('tool_sessions_ip_hash_idx').on(table.ipHashDay),
    index('tool_sessions_user_idx').on(table.userId),
    index('tool_sessions_converted_idx').on(table.convertedUserId),
  ],
).enableRLS();
