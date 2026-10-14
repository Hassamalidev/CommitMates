import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertTestUser, useTestDatabase, type TestDatabase } from '../testing';

/** Tables of the social and streak groups that the browser must never read (CLAUDE.md §5.9). */
const SERVER_ONLY = [
  'match_suggestions',
  'connections',
  'message_requests',
  'threads',
  'blocks',
  'reports',
  'trust_scores',
  'pairs',
  'pair_days',
  'pair_companions',
];

let database: TestDatabase;
let userA: string;
let userB: string;
let userC: string;
let threadAB: string;
let threadBC: string;

async function as<T>(role: 'anon' | 'authenticated', userId: string | null, query: string): Promise<T[]> {
  const rows: unknown[] = await database.sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    if (userId) await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return [...(await tx.unsafe(query))];
  });
  return rows as T[];
}

const messageBodies = async (userId: string | null, role: 'anon' | 'authenticated' = 'authenticated') =>
  (await as<{ body: string }>(role, userId, 'select body from messages order by body')).map((row) => row.body);

beforeAll(async () => {
  database = await useTestDatabase();
  userA = await insertTestUser(database.sql);
  userB = await insertTestUser(database.sql);
  userC = await insertTestUser(database.sql);
  const [ab] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
  const [bc] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
  threadAB = ab!.id;
  threadBC = bc!.id;
  await database.sql`insert into thread_members (thread_id, user_id) values
    (${threadAB}, ${userA}), (${threadAB}, ${userB}), (${threadBC}, ${userB}), (${threadBC}, ${userC})`;
  await database.sql`insert into messages (thread_id, author_user_id, body) values
    (${threadAB}, ${userA}, 'a to b'), (${threadAB}, ${userB}, 'b to a'), (${threadBC}, ${userC}, 'c to b')`;
  await database.sql`insert into message_requests (from_user, to_user, context_kind, first_message) values (${userA}, ${userC}, 'discover', 'hello')`;
  await database.sql`insert into blocks (blocker, blocked) values (${userA}, ${userC})`;
  const [first, second] = [userA, userB].sort();
  const [pair] = await database.sql<{ id: string }[]>`insert into pairs (user_a, user_b) values (${first!}, ${second!}) returning id`;
  await database.sql`insert into pair_companions (pair_id, seed) values (${pair!.id}, 1)`;
});
afterAll(async () => {
  await database.destroy();
});

describe('social row level security', () => {
  it('shows each member only the messages of their own threads', async () => {
    expect(await messageBodies(userA)).toEqual(['a to b', 'b to a']);
    expect(await messageBodies(userC)).toEqual(['c to b']);
    expect(await messageBodies(userB)).toEqual(['a to b', 'b to a', 'c to b']);
    expect(await messageBodies(null)).toEqual([]);
    expect(await messageBodies(null, 'anon')).toEqual([]);
  });

  it('shows each member only their own thread memberships', async () => {
    const rows = await as<{ thread_id: string; user_id: string }>('authenticated', userA, 'select thread_id, user_id from thread_members');
    expect(rows).toEqual([{ thread_id: threadAB, user_id: userA }]);
    expect(await as('authenticated', userC, 'select 1 from thread_members')).toHaveLength(1);
    expect(await as('anon', null, 'select 1 from thread_members')).toHaveLength(0);
  });

  it('hides every other social and streak table from the browser', async () => {
    for (const table of SERVER_ONLY) {
      expect(await as('authenticated', userA, `select 1 from "${table}"`), `authenticated reading ${table}`).toHaveLength(0);
      expect(await as('anon', null, `select 1 from "${table}"`), `anon reading ${table}`).toHaveLength(0);
    }
    // The rows exist: the server connection sees them.
    expect(await database.sql`select 1 from message_requests`).toHaveLength(1);
  });

  it('rejects writes from the browser, even into a member’s own thread', async () => {
    const write = database.sql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      await tx`select set_config('request.jwt.claim.sub', ${userA}, true)`;
      await tx`insert into messages (thread_id, author_user_id, body) values (${threadAB}, ${userA}, 'forged')`;
    });
    await expect(write).rejects.toThrow(/row-level security/);
  });

  it('publishes messages, memberships and notifications to Realtime when the publication exists', async () => {
    const [publication] = await database.sql`select 1 from pg_publication where pubname = 'supabase_realtime'`;
    if (!publication) return;
    const tables = await database.sql<{ tablename: string }[]>`
      select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`;
    expect(tables.map((row) => row.tablename)).toEqual(expect.arrayContaining(['messages', 'notifications', 'thread_members']));
  });
});

describe('social constraints', () => {
  it('stores pairs and connections once, ordered, and blocks a second pending request', async () => {
    const [low, high] = [userB, userC].sort();
    await expect(database.sql`insert into pairs (user_a, user_b) values (${high!}, ${low!})`).rejects.toThrow(/pairs_ordered/);
    await expect(database.sql`insert into connections (user_a, user_b, source) values (${high!}, ${low!}, 'match')`).rejects.toThrow(
      /connections_ordered/,
    );
    await expect(
      database.sql`insert into message_requests (from_user, to_user, context_kind, first_message) values (${userA}, ${userC}, 'discover', 'again')`,
    ).rejects.toThrow(/message_requests_pending_pair_key/);
    const [first, second] = [userA, userB].sort();
    await expect(database.sql`insert into pairs (user_a, user_b) values (${first!}, ${second!})`).rejects.toThrow(/pairs_open_pair_key/);
  });

  it('keeps a deleted author’s messages for the system note, and removes the member’s private rows', async () => {
    const extra = await insertTestUser(database.sql);
    await database.sql`insert into thread_members (thread_id, user_id) values (${threadBC}, ${extra})`;
    await database.sql`insert into messages (thread_id, author_user_id, body) values (${threadBC}, ${extra}, 'from extra')`;
    await database.sql`delete from auth.users where id = ${extra}`;
    expect(await database.sql`select author_user_id from messages where body = 'from extra'`).toEqual([{ author_user_id: null }]);
    expect(await database.sql`select 1 from thread_members where user_id = ${extra}`).toHaveLength(0);
  });
});
