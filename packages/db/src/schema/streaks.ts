import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, pgEnum, pgTable, primaryKey, smallint, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './columns';
import { users } from './identity';

export const pairStatus = pgEnum('pair_status', ['active', 'paused', 'ended']);
export const pairDayOutcome = pgEnum('pair_day_outcome', ['counted', 'frozen', 'missed']);
export const companionMood = pgEnum('companion_mood', ['happy', 'neutral', 'sad']);

/** Two members keeping a shared streak (CLAUDE.md §7.7, §8 F13), stored with `user_a < user_b`. */
export const pairs = pgTable(
  'pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userA: uuid('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: uuid('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: pairStatus('status').notNull().default('active'),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    freezesAvailable: smallint('freezes_available').notNull().default(0),
    missedInRow: smallint('missed_in_row').notNull().default(0),
    lastJudgedDay: date('last_judged_day', { mode: 'string' }),
    createdAt: createdAt(),
    endedAt: timestamptz('ended_at'),
  },
  (table) => [
    // One pair that has not ended per two members.
    uniqueIndex('pairs_open_pair_key').on(table.userA, table.userB).where(sql`${table.status} <> 'ended'`),
    index('pairs_user_b_idx').on(table.userB),
    index('pairs_status_idx').on(table.status),
    check('pairs_ordered', sql`${table.userA} < ${table.userB}`),
  ],
).enableRLS();

/** How one day went for a pair. */
export const pairDays = pgTable(
  'pair_days',
  {
    pairId: uuid('pair_id')
      .notNull()
      .references(() => pairs.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    aCount: integer('a_count').notNull(),
    bCount: integer('b_count').notNull(),
    outcome: pairDayOutcome('outcome').notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.pairId, table.day] })],
).enableRLS();

/** The pair's shared companion: its seed, evolution stage and mood (§8 F13, §9.5). */
export const pairCompanions = pgTable('pair_companions', {
  pairId: uuid('pair_id')
    .primaryKey()
    .references(() => pairs.id, { onDelete: 'cascade' }),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  stage: smallint('stage').notNull().default(0),
  mood: companionMood('mood').notNull().default('neutral'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
