import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertTestUser, useTestDatabase, type TestDatabase } from '../testing';

/** Collaboration tables the browser never reads (CLAUDE.md §5.9): all writes go through Server Actions. */
const SERVER_ONLY = [
  'graveyard_listings',
  'listing_suggestions',
  'adoptions',
  'review_requests',
  'reviews',
  'credit_ledger',
  'credit_balances',
  'ledger_locks',
  'swap_offers',
  'swap_wants',
  'swap_proposals',
  'swap_responses',
  'legacy_entries',
  'oss_member_contribs',
];

let database: TestDatabase;
let member: string;

const balance = async (userId: string) =>
  (await database.sql<{ balance: number }[]>`select balance from credit_balances where user_id = ${userId}`)[0]?.balance ?? null;

beforeAll(async () => {
  database = await useTestDatabase();
  member = await insertTestUser(database.sql);
  await database.sql`insert into credit_ledger (user_id, delta, reason) values (${member}, 1, 'starter'), (${member}, -1, 'escrow'), (${member}, 2, 'release')`;
});
afterAll(async () => {
  await database.destroy();
});

describe('credit ledger', () => {
  it('sums to a balance', async () => {
    expect(await balance(member)).toBe(2);
  });

  it('rejects updates and deletes', async () => {
    await expect(database.sql`update credit_ledger set delta = 100 where user_id = ${member}`).rejects.toThrow(/append-only: update/);
    await expect(database.sql`delete from credit_ledger where user_id = ${member}`).rejects.toThrow(/append-only: delete/);
    expect(await balance(member)).toBe(2);
  });

  it('still lets an account deletion remove the member’s rows', async () => {
    const leaving = await insertTestUser(database.sql);
    await database.sql`insert into credit_ledger (user_id, delta, reason) values (${leaving}, 1, 'starter')`;
    await database.sql`delete from auth.users where id = ${leaving}`;
    expect(await database.sql`select 1 from credit_ledger where user_id = ${leaving}`).toHaveLength(0);
    expect(await balance(member)).toBe(2);
  });
});

describe('collaboration tables', () => {
  it('are closed to the browser roles', async () => {
    for (const table of SERVER_ONLY) {
      for (const role of ['anon', 'authenticated'] as const) {
        const rows: unknown[] = await database.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select set_config('request.jwt.claim.sub', ${member}, true)`;
          return [...(await tx.unsafe(`select * from ${table}`))];
        });
        expect(rows, `${role} reading ${table}`).toEqual([]);
      }
    }
  });

  it('keeps one open listing per repository and one review per request', async () => {
    await database.sql`insert into graveyard_listings (repo_github_id, owner_user_id) values (42, ${member})`;
    await expect(database.sql`insert into graveyard_listings (repo_github_id, owner_user_id) values (42, ${member})`).rejects.toThrow(/duplicate key/);
    await database.sql`update graveyard_listings set status = 'withdrawn' where repo_github_id = 42`;
    await database.sql`insert into graveyard_listings (repo_github_id, owner_user_id) values (42, ${member})`;

    const [university] = await database.sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
    const [request] = await database.sql<{ id: string }[]>`
      insert into review_requests (author_user_id, university_id, pr_url, repo_full_name, pr_number, languages, expires_at)
      values (${member}, ${university!.id}, 'https://github.com/a/b/pull/1', 'a/b', 1, '{TypeScript}', now() + interval '14 days') returning id`;
    const reviewer = await insertTestUser(database.sql);
    await database.sql`insert into reviews (request_id, reviewer_user_id, gh_review_ids, line_comment_count, verified_at) values (${request!.id}, ${reviewer}, '{1}', 3, now())`;
    await expect(
      database.sql`insert into reviews (request_id, reviewer_user_id, gh_review_ids, line_comment_count, verified_at) values (${request!.id}, ${reviewer}, '{2}', 3, now())`,
    ).rejects.toThrow(/duplicate key/);
  });
});
