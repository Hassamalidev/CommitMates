import postgres from 'postgres';

/** The local Supabase database that the app under test uses. */
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Runs statements against the app's database, for test setup that has no UI yet. */
export async function withAppDatabase<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DIRECT_DATABASE_URL ?? LOCAL_DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Makes a test member an admin. In production the only path is the bootstrap account. */
export async function grantAdmin(userId: string): Promise<void> {
  await withAppDatabase(async (sql) => {
    await sql`insert into users (id) values (${userId}) on conflict (id) do nothing`;
    await sql`insert into profiles (user_id, timezone) values (${userId}, 'UTC') on conflict (user_id) do nothing`;
    await sql`insert into roles (user_id, role) values (${userId}, 'admin') on conflict do nothing`;
  });
}
