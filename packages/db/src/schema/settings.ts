import { sql } from 'drizzle-orm';
import { bigserial, check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './columns';

export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    valueType: text('value_type').notNull(),
    defaultValue: jsonb('default_value').notNull(),
    computedValue: jsonb('computed_value'),
    overrideValue: jsonb('override_value'),
    sampleSize: integer('sample_size').notNull().default(0),
    /** 0 means the key is never computed: default or override only. */
    minSample: integer('min_sample').notNull().default(0),
    computedAt: timestamptz('computed_at'),
    unit: text('unit'),
    description: text('description').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'settings_value_type_check',
      sql`${table.valueType} in ('number','integer','boolean','string','string[]','number[]','json')`,
    ),
  ],
).enableRLS();

export const settingsHistory = pgTable(
  'settings_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    key: text('key')
      .notNull()
      .references(() => settings.key),
    field: text('field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    source: text('source').notNull(),
    actorUserId: uuid('actor_user_id'),
    createdAt: createdAt(),
  },
  (table) => [
    check('settings_history_field_check', sql`${table.field} in ('computed','override','default')`),
    check('settings_history_source_check', sql`${table.source} in ('recompute','admin','migration')`),
    index('settings_history_key_idx').on(table.key, table.createdAt.desc()),
  ],
).enableRLS();
