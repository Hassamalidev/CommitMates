import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { createDb, setDb, type Db } from '../client';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate';

/**
 * Scratch databases for integration tests (CLAUDE.md §11.3).
 *
 * Each test file gets its own database, cloned from a template that already has every
 * migration applied. Databases, not schemas, are the unit of isolation because the
 * migrations create enum types in `public`. A fresh database has no Supabase `auth`
 * schema, so the template is given a minimal stand-in with the same contract.
 */

export type TestDatabase = {
  url: string;
  db: Db;
  /** Raw client for statements Drizzle does not model, e.g. `set local role`. */
  sql: postgres.Sql;
  /** Closes connections and drops the database. */
  destroy: () => Promise<void>;
};

/** The local Supabase stack's Postgres (`pnpm db:start`). */
const LOCAL_ADMIN_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
/** Advisory lock key that serializes template creation across parallel test processes. */
const TEMPLATE_LOCK_KEY = 4_815_162_342;
const TEMPLATE_PREFIX = 'cm_template_';
const TEST_PREFIX = 'cm_test_';
/** Characters of the migrations checksum used in the template name. */
const CHECKSUM_LENGTH = 16;
/** Random bytes in a scratch database name. */
const NAME_ENTROPY_BYTES = 8;

function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DIRECT_DATABASE_URL ?? LOCAL_ADMIN_URL;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function migrationsChecksum(): string {
  const hash = createHash('sha256');
  const files = readdirSync(MIGRATIONS_FOLDER, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) {
    hash.update(path.relative(MIGRATIONS_FOLDER, file));
    hash.update(readFileSync(file));
  }
  hash.update(SUPABASE_STAND_IN);
  return hash.digest('hex').slice(0, CHECKSUM_LENGTH);
}

/**
 * What a Supabase project provides before our migrations run: the API roles, default
 * grants on `public` (so that RLS, not missing grants, is what denies access), and the
 * `auth` schema with `auth.users` and `auth.uid()`.
 */
const SUPABASE_STAND_IN = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
`;

async function ensureTemplate(admin: postgres.Sql): Promise<string> {
  const template = `${TEMPLATE_PREFIX}${migrationsChecksum()}`;
  const lock = await admin.reserve();
  try {
    await lock`select pg_advisory_lock(${TEMPLATE_LOCK_KEY})`;
    const existing = await lock`select 1 from pg_database where datname = ${template}`;
    if (existing.length > 0) return template;

    // Templates for older migration sets are no longer needed.
    const stale = await lock<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${TEMPLATE_PREFIX}%`}`;
    for (const { datname } of stale) {
      await lock.unsafe(`drop database if exists "${datname}" with (force)`);
    }

    const building = `${template}_building`;
    await lock.unsafe(`drop database if exists "${building}" with (force)`);
    await lock.unsafe(`create database "${building}"`);
    const url = withDatabase(adminUrl(), building);
    const setup = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      await setup.unsafe(SUPABASE_STAND_IN);
    } finally {
      await setup.end({ timeout: 5 });
    }
    await runMigrations(url);
    await lock.unsafe(`alter database "${building}" rename to "${template}"`);
    return template;
  } finally {
    await lock`select pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`;
    lock.release();
  }
}

/** Creates a migrated scratch database. Call `destroy()` in `afterAll`. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const admin = postgres(adminUrl(), { max: 2, onnotice: () => undefined });
  const name = `${TEST_PREFIX}${randomBytes(NAME_ENTROPY_BYTES).toString('hex')}`;
  try {
    const template = await ensureTemplate(admin);
    await admin.unsafe(`create database "${name}" template "${template}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const url = withDatabase(adminUrl(), name);
  const handle = createDb(url);
  const sql = postgres(url, { max: 2, onnotice: () => undefined });

  return {
    url,
    db: handle.db,
    sql,
    destroy: async () => {
      await sql.end({ timeout: 5 });
      await handle.close();
      const dropper = postgres(adminUrl(), { max: 1, onnotice: () => undefined });
      try {
        await dropper.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end({ timeout: 5 });
      }
    },
  };
}

/**
 * Creates a scratch database and makes it the process-wide pool, so query modules that
 * call `getDb()` use it. Returns the same handle; `destroy()` also clears the pool.
 */
export async function useTestDatabase(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  setDb({ db: database.db, close: () => Promise.resolve() });
  return {
    ...database,
    destroy: async () => {
      setDb(undefined);
      await database.destroy();
    },
  };
}

/** Inserts an auth user and its `users` row; returns the id. */
export async function insertTestUser(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`insert into auth.users default values returning id`;
  if (!row) throw new Error('auth.users insert returned no row');
  await sql`insert into users (id) values (${row.id})`;
  return row.id;
}
