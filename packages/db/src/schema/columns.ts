import { customType, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text for logins, emails and domains (CLAUDE.md §7). */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** Postgres full-text search vectors, usually a generated column (CLAUDE.md §3.1 "Search"). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** All timestamps are stored in UTC (CLAUDE.md §10.6). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();

/** Kept current by the `set_updated_at` trigger. */
export const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();
