import { randomUUID } from 'node:crypto';

import { getDb, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adjustCredits, escrowCredit, getCredits, grantStarterCredits, settleEscrow } from './ledger';

/** Escrows attempted at once against a balance of a few credits (P5-T04 "Done when"). */
const PARALLEL_ESCROWS = 50;
const STARTING_BALANCE = 3;

let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

const member = () => insertTestUser(database.sql);
const balance = async (userId: string) => (await getCredits(userId)).balance;
const escrow = (authorId: string, requestId: string = randomUUID()) => getDb().transaction((tx) => escrowCredit(tx, authorId, requestId));
const credit = (userId: string, delta: number) =>
  database.sql`insert into credit_ledger (user_id, delta, reason) values (${userId}, ${delta}, 'admin_adjust')`;

/** The lowest running balance over a member's rows in the order they were written. */
async function lowestRunningBalance(userId: string): Promise<number> {
  const [row] = await database.sql<{ lowest: number }[]>`
    select min(running)::int as lowest from (
      select sum(delta) over (order by id) as running from credit_ledger where user_id = ${userId}) steps`;
  return row?.lowest ?? 0;
}

describe('starter credits', () => {
  it('grants reviews.starterCredits once, however often it is asked', async () => {
    const userId = await member();
    const results = await Promise.all([grantStarterCredits(userId), grantStarterCredits(userId), grantStarterCredits(userId)]);
    expect(results.sort()).toEqual([0, 0, 1]);
    expect(await grantStarterCredits(userId)).toBe(0);
    expect(await getCredits(userId)).toMatchObject({ balance: 1, history: [{ delta: 1, reason: 'starter', requestId: null }] });
  });

  it('follows the setting, and grants nothing at 0', async () => {
    const [two, none] = [await member(), await member()];
    await withSettings({ 'reviews.starterCredits': 2 }, () => grantStarterCredits(two));
    await withSettings({ 'reviews.starterCredits': 0 }, () => grantStarterCredits(none));
    expect([await balance(two), await balance(none)]).toEqual([2, 0]);
  });
});

describe('escrow', () => {
  it(`never goes below zero when ${PARALLEL_ESCROWS} escrows race for ${STARTING_BALANCE} credits`, async () => {
    const author = await member();
    await credit(author, STARTING_BALANCE);
    const outcomes = await Promise.allSettled(Array.from({ length: PARALLEL_ESCROWS }, () => escrow(author)));
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(STARTING_BALANCE);
    expect(rejected).toHaveLength(PARALLEL_ESCROWS - STARTING_BALANCE);
    for (const outcome of rejected) expect(outcome.reason).toMatchObject({ code: 'reviews.no_credit' });
    expect(await balance(author)).toBe(0);
    expect(await lowestRunningBalance(author)).toBe(0);
  });

  it('refuses a member without credit, and rolls back with the caller’s transaction', async () => {
    const author = await member();
    await expect(escrow(author)).rejects.toMatchObject({ code: 'reviews.no_credit', userMessage: "Review someone else's code to earn a credit." });
    await credit(author, 1);
    await expect(
      getDb().transaction(async (tx) => {
        await escrowCredit(tx, author, randomUUID());
        throw new Error('the request insert failed');
      }),
    ).rejects.toThrow('the request insert failed');
    expect(await balance(author)).toBe(1);
  });
});

describe('settlement', () => {
  it('releases a held escrow to the reviewer exactly once, even when settled twice at the same time', async () => {
    const [author, reviewer] = [await member(), await member()];
    await credit(author, 1);
    const requestId = randomUUID();
    await escrow(author, requestId);
    const settle = () => getDb().transaction((tx) => settleEscrow(tx, { authorId: author, requestId, outcome: 'release', reviewerId: reviewer }));
    const refund = () => getDb().transaction((tx) => settleEscrow(tx, { authorId: author, requestId, outcome: 'refund' }));
    const results = await Promise.all([settle(), settle(), refund()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await balance(author)) + (await balance(reviewer))).toBe(1);
    expect(await settle()).toBe(false);
  });

  it('refunds the author, and settles nothing for a request that never held credit', async () => {
    const [author, reviewer] = [await member(), await member()];
    await credit(author, 1);
    const requestId = randomUUID();
    await escrow(author, requestId);
    expect(await getDb().transaction((tx) => settleEscrow(tx, { authorId: author, requestId, outcome: 'refund' }))).toBe(true);
    expect([await balance(author), await balance(reviewer)]).toEqual([1, 0]);
    // Another author's escrow, or none at all, settles nothing.
    expect(await getDb().transaction((tx) => settleEscrow(tx, { authorId: reviewer, requestId, outcome: 'refund' }))).toBe(false);
    expect(await getDb().transaction((tx) => settleEscrow(tx, { authorId: author, requestId: randomUUID(), outcome: 'release', reviewerId: reviewer }))).toBe(false);
    expect(await balance(reviewer)).toBe(0);
  });
});

describe('admin adjustments', () => {
  it('lets admins correct a balance with an audit entry, never below zero', async () => {
    const [admin, someone] = [await member(), await member()];
    await database.sql`insert into github_identities (user_id, github_id, login) values (${someone}, 990001, 'credited-member')`;
    await database.sql`insert into profiles (user_id, timezone) values (${someone}, 'UTC')`;
    const actor = { id: admin, roles: [{ role: 'admin' as const, universityId: null }] };
    await expect(adjustCredits({ id: admin, roles: [] }, { login: 'credited-member', delta: 2, note: 'Dispute' })).rejects.toMatchObject({
      code: 'reviews.adjust_forbidden',
    });
    expect(await adjustCredits(actor, { login: '@credited-member', delta: '2', note: 'Dispute settled for the reviewer' })).toBe(2);
    await expect(adjustCredits(actor, { login: 'credited-member', delta: -3, note: 'Too much' })).rejects.toMatchObject({ code: 'reviews.adjust_negative' });
    await expect(adjustCredits(actor, { login: 'credited-member', delta: 0, note: 'Nothing' })).rejects.toThrow();
    await expect(adjustCredits(actor, { login: 'nobody-here', delta: 1, note: 'Typo' })).rejects.toMatchObject({ code: 'reviews.adjust_unknown' });
    expect(await balance(someone)).toBe(2);
    const [audit] = await database.sql`select action, actor_user_id, data from audit_log where target_id = ${someone}`;
    expect(audit).toMatchObject({ action: 'credits.adjusted', actor_user_id: admin, data: { delta: 2, note: 'Dispute settled for the reviewer' } });
  });
});
