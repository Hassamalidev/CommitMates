import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './columns';

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'done', 'failed', 'dead', 'cancelled']);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('queued'),
    /** Higher runs first. */
    priority: smallint('priority').notNull().default(0),
    runAt: timestamptz('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    lockedAt: timestamptz('locked_at'),
    lockedBy: text('locked_by'),
    idempotencyKey: text('idempotency_key').unique(),
    /** `{ step, pct, message }`, streamed to the browser over SSE. */
    progress: jsonb('progress'),
    /** Pointer to the stored result. */
    resultRef: jsonb('result_ref'),
    lastError: text('last_error'),
    userMessage: text('user_message'),
    /** Continuation chain. */
    parentId: uuid('parent_id').references((): AnyPgColumn => jobs.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('jobs_ready_idx')
      .on(table.priority.desc(), table.runAt)
      .where(sql`${table.status} = 'queued'`),
    index('jobs_running_idx')
      .on(table.lockedAt)
      .where(sql`${table.status} = 'running'`),
    index('jobs_parent_idx').on(table.parentId),
    index('jobs_type_status_idx').on(table.type, table.status),
  ],
).enableRLS();

export const jobSchedules = pgTable('job_schedules', {
  name: text('name').primaryKey(),
  cronExpr: text('cron_expr').notNull(),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamptz('last_run_at'),
  nextRunAt: timestamptz('next_run_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();
