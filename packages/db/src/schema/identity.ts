import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, createdAt, timestamptz, updatedAt } from './columns';
import { universities } from './universities';

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'hidden_pending_review']);
export const profileRole = pgEnum('profile_role', ['student', 'alumni', 'supervisor_pending', 'supervisor']);
export const profileVisibility = pgEnum('profile_visibility', ['university', 'country', 'public', 'hidden']);
export const verifiedVia = pgEnum('verified_via', ['email', 'vouch', 'admin']);
export const roleKind = pgEnum('role_kind', ['admin', 'uni_moderator']);

/** `id` equals `auth.users.id`; the foreign key (on delete cascade) is added in SQL. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  status: userStatus('status').notNull().default('active'),
  lastSeenAt: timestamptz('last_seen_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const githubIdentities = pgTable('github_identities', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
  login: citext('login').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  tokenEnc: text('token_enc'),
  tokenKeyVersion: smallint('token_key_version'),
  tokenInvalid: boolean('token_invalid').notNull().default(false),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  privateContribVisible: boolean('private_contrib_visible').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

/** `university_id` and `department_id` get their foreign keys with those tables in Phase 3. */
export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    // A university with members is never deleted (§6.4), so no delete rule is needed.
    universityId: uuid('university_id').references(() => universities.id),
    role: profileRole('role').notNull().default('student'),
    gradYear: smallint('grad_year'),
    departmentId: uuid('department_id'),
    timezone: text('timezone').notNull(),
    visibility: profileVisibility('visibility').notNull().default('university'),
    ghostMode: boolean('ghost_mode').notNull().default(false),
    learningGoals: text('learning_goals').array().notNull().default(sql`'{}'::text[]`),
    bio: text('bio'),
    onboardedAt: timestamptz('onboarded_at'),
    verifiedAt: timestamptz('verified_at'),
    verifiedVia: verifiedVia('verified_via'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('profiles_university_idx').on(table.universityId),
    index('profiles_department_idx').on(table.departmentId),
  ],
).enableRLS();

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleKind('role').notNull(),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by'),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('roles_user_role_university_key').on(
      table.userId,
      table.role,
      sql`coalesce(${table.universityId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('roles_university_idx').on(table.universityId),
  ],
).enableRLS();
