import { serverEnv } from '@commitmates/env/server';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction handle; accepts the same queries as `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export type DbHandle = { db: Db; close: () => Promise<void> };

export type CreateDbOptions = {
  /** Connections held by this process. Serverless functions should stay small. */
  max?: number;
};

/** Default pool size: enough for a tick's parallel queries without exhausting the pooler. */
const DEFAULT_POOL_SIZE = 5;
/** Seconds an idle connection is kept before it is closed. */
const IDLE_TIMEOUT_SECONDS = 20;

/** Opens a connection pool. `prepare: false` is required by Supabase's transaction pooler (CLAUDE.md §3.1). */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? DEFAULT_POOL_SIZE,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    onnotice: () => undefined,
  });
  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    close: () => client.end({ timeout: 5 }),
  };
}

let shared: DbHandle | undefined;

/** The process-wide pool on `DATABASE_URL`, opened on first use. */
export function getDb(): Db {
  shared ??= createDb(serverEnv.DATABASE_URL);
  return shared.db;
}

/** Replaces the process-wide pool; used by tests to point every query module at a scratch database. */
export function setDb(handle: DbHandle | undefined): void {
  shared = handle;
}

export async function closeDb(): Promise<void> {
  const current = shared;
  shared = undefined;
  await current?.close();
}
