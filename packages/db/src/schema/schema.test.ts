import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, insertTestUser, type TestDatabase } from '../testing';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});

const PLATFORM_TABLES = [
  'users',
  'github_identities',
  'profiles',
  'roles',
  'settings',
  'settings_history',
  'jobs',
  'job_schedules',
  'api_cache',
  'github_budgets',
  'rate_limit_buckets',
  'metric_samples',
  'salts',
  'geocode_cache',
  'geocoder_lock',
  'source_snapshots',
  'audit_log',
  'notifications',
  'notification_prefs',
  'feedback',
  'tool_sessions',
];

describe('schema v1', () => {
  it('creates every platform table on a fresh database', async () => {
    const rows = await database.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'`;
    expect(rows.map((row) => row.tablename)).toEqual(expect.arrayContaining(PLATFORM_TABLES));
  });

  it('enables row level security on every table', async () => {
    const rows = await database.sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it('defines policies only where the browser may read', async () => {
    const rows = await database.sql<{ tablename: string; policyname: string; cmd: string }[]>`
      select tablename, policyname, cmd from pg_policies where schemaname = 'public'`;
    expect(rows.every((row) => row.cmd === 'SELECT')).toBe(true);
    expect(rows.map((row) => row.tablename)).toEqual(expect.arrayContaining(['notifications']));
    const browserReadable = new Set(['notifications', 'messages', 'thread_members']);
    expect(rows.filter((row) => !browserReadable.has(row.tablename))).toEqual([]);
  });

  it('seeds the single geocoder lock row and rejects a second one', async () => {
    const rows = await database.sql`select id from geocoder_lock`;
    expect(rows).toHaveLength(1);
    await expect(database.sql`insert into geocoder_lock (id) values (2)`).rejects.toThrow(/geocoder_lock_single_row/);
  });

  it('keeps updated_at current', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`update users set updated_at = now() - interval '1 day' where id = ${userId}`;
    const [before] = await database.sql<{ updated_at: Date }[]>`select updated_at from users where id = ${userId}`;
    await database.sql`update users set status = 'suspended' where id = ${userId}`;
    const [after] = await database.sql<{ updated_at: Date }[]>`select updated_at from users where id = ${userId}`;
    expect(after!.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime() - 1);
    expect(Date.now() - after!.updated_at.getTime()).toBeLessThan(60_000);
  });

  it('deletes a member when the auth user is deleted', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into profiles (user_id, timezone) values (${userId}, 'UTC')`;
    await database.sql`delete from auth.users where id = ${userId}`;
    expect(await database.sql`select 1 from users where id = ${userId}`).toHaveLength(0);
    expect(await database.sql`select 1 from profiles where user_id = ${userId}`).toHaveLength(0);
  });

  it('allows one role per user and scope', async () => {
    const userId = await insertTestUser(database.sql);
    await database.sql`insert into roles (user_id, role) values (${userId}, 'admin')`;
    await expect(database.sql`insert into roles (user_id, role) values (${userId}, 'admin')`).rejects.toThrow(
      /roles_user_role_university_key/,
    );
  });

  it('validates setting types', async () => {
    await expect(
      database.sql`insert into settings (key, value_type, default_value, description)
                   values ('x.y', 'float', '1', 'bad type')`,
    ).rejects.toThrow(/settings_value_type_check/);
  });
});

describe('row level security', () => {
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    userA = await insertTestUser(database.sql);
    userB = await insertTestUser(database.sql);
    await database.sql`insert into notifications (user_id, kind) values (${userA}, 'test'), (${userB}, 'test')`;
    await database.sql`insert into jobs (type, max_attempts) values ('rls_probe', 1)`;
    await database.sql`insert into audit_log (action, target_type, target_id) values ('probe', 'test', '1')`;
    await database.sql`insert into tool_sessions (tool, ip_hash_day) values ('probe', 'hash')`;
  });

  async function countAs(role: 'anon' | 'authenticated', table: string, userId?: string): Promise<number> {
    return database.sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      if (userId) await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      const [row] = await tx.unsafe<{ count: number }[]>(`select count(*)::int as count from "${table}"`);
      return row!.count;
    });
  }

  it('hides every platform table from anon and authenticated', async () => {
    for (const table of PLATFORM_TABLES.filter((name) => name !== 'notifications')) {
      expect(await countAs('anon', table), `anon reading ${table}`).toBe(0);
      expect(await countAs('authenticated', table, userA), `authenticated reading ${table}`).toBe(0);
    }
    // The rows exist: the owner connection sees them.
    const [jobsRow] = await database.sql<{ count: number }[]>`select count(*)::int as count from jobs`;
    expect(jobsRow!.count).toBeGreaterThan(0);
  });

  it('lets a member read only their own notifications', async () => {
    expect(await countAs('anon', 'notifications')).toBe(0);
    expect(await countAs('authenticated', 'notifications', userA)).toBe(1);
    expect(await countAs('authenticated', 'notifications', userB)).toBe(1);
    expect(await countAs('authenticated', 'notifications')).toBe(0);
  });

  it('rejects browser writes', async () => {
    const write = database.sql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      await tx`select set_config('request.jwt.claim.sub', ${userA}, true)`;
      await tx`insert into notifications (user_id, kind) values (${userA}, 'forged')`;
    });
    await expect(write).rejects.toThrow(/row-level security/);
  });

  it('does not let the browser spend rate-limit tokens', async () => {
    const call = database.sql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      await tx`select take_token('probe', 1, 1)`;
    });
    await expect(call).rejects.toThrow(/permission denied/);
  });
});

describe('take_token', () => {
  const take = async (key: string, capacity: number, refillPerSec: number, cost = 1) => {
    const [row] = await database.sql<{ ok: boolean }[]>`
      select take_token(${key}, ${capacity}, ${refillPerSec}, ${cost}) as ok`;
    return row!.ok;
  };

  it('allows up to capacity, then refuses', async () => {
    expect(await take('bucket:exhaust', 3, 0)).toBe(true);
    expect(await take('bucket:exhaust', 3, 0)).toBe(true);
    expect(await take('bucket:exhaust', 3, 0)).toBe(true);
    expect(await take('bucket:exhaust', 3, 0)).toBe(false);
  });

  it('refills over time without exceeding capacity', async () => {
    expect(await take('bucket:refill', 2, 1)).toBe(true);
    expect(await take('bucket:refill', 2, 1)).toBe(true);
    await database.sql`update rate_limit_buckets set updated_at = updated_at - interval '1 second', tokens = 0
                       where key = 'bucket:refill'`;
    expect(await take('bucket:refill', 2, 1)).toBe(true);
    expect(await take('bucket:refill', 2, 0)).toBe(false);

    await database.sql`update rate_limit_buckets set updated_at = updated_at - interval '1 hour'
                       where key = 'bucket:refill'`;
    expect(await take('bucket:refill', 2, 1, 2)).toBe(true);
    expect(await take('bucket:refill', 2, 0)).toBe(false);
  });

  it('refuses a cost above the available tokens without spending any', async () => {
    expect(await take('bucket:cost', 2, 0, 3)).toBe(false);
    expect(await take('bucket:cost', 2, 0, 2)).toBe(true);
  });
});
