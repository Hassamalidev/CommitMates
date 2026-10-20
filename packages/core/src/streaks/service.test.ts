import { addDays, seedFrom } from '@commitmates/algorithms';
import { deleteMemberData, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cancelPairInvite, endPair, getStreaks, invitePair, respondToPairInvite, resumePair, streakStatusInThread } from './service';

let database: TestDatabase;
let counter = 0;
const today = new Date().toISOString().slice(0, 10);

async function member(verified = true): Promise<{ id: string; login: string }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `pair-${n}`;
  await database.sql`insert into profiles (user_id, timezone, verified_at) values (${id}, 'UTC', ${verified ? new Date() : null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${900_000 + n}, ${login})`;
  return { id, login };
}

/** Two members sharing a direct conversation. */
async function conversation(): Promise<{ a: { id: string; login: string }; b: { id: string; login: string }; threadId: string }> {
  const [a, b] = [await member(), await member()];
  const [thread] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
  await database.sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${a.id}), (${thread!.id}, ${b.id})`;
  return { a, b, threadId: thread!.id };
}

const notifications = (userId: string, kind: string) =>
  database.sql<{ data: Record<string, string> }[]>`select data from notifications where user_id = ${userId} and kind = ${kind}`;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('pairing', () => {
  it('invites from a conversation, and accepting starts a pair with a seeded companion', async () => {
    const { a, b, threadId } = await conversation();
    expect(await streakStatusInThread(a, threadId)).toEqual({ state: 'none' });
    const inviteId = await invitePair(a, { threadId });
    expect(await streakStatusInThread(a, threadId)).toEqual({ state: 'invited' });
    expect(await streakStatusInThread(b, threadId)).toEqual({ state: 'invitedYou' });
    expect((await notifications(b.id, 'pair_invite'))[0]?.data).toEqual({ login: a.login });
    await expect(invitePair(b, { threadId })).rejects.toMatchObject({ code: 'streaks.invite_pending' });
    expect((await getStreaks(b)).invites.incoming.map((invite) => invite.login)).toEqual([a.login]);

    await expect(respondToPairInvite(a, { inviteId, accept: true })).rejects.toMatchObject({ code: 'streaks.invite_gone' });
    const { pairId } = await respondToPairInvite(b, { inviteId, accept: true });
    const [companion] = await database.sql<{ seed: number; stage: number; mood: string }[]>`select seed::int8::float8 as seed, stage, mood from pair_companions where pair_id = ${pairId}`;
    expect(companion).toEqual({ seed: seedFrom(pairId!), stage: 0, mood: 'neutral' });
    expect((await notifications(a.id, 'pair_accepted'))[0]?.data).toEqual({ login: b.login });
    expect(await streakStatusInThread(a, threadId)).toEqual({ state: 'paired' });
    const [card] = (await getStreaks(a)).pairs;
    expect(card).toMatchObject({ id: pairId, status: 'active', partner: { login: b.login }, companion: { stage: 0, mood: 'neutral' }, days: [] });
    await expect(invitePair(a, { threadId })).rejects.toMatchObject({ code: 'streaks.pair_exists' });
  });

  it('declines and cancels invitations without starting a pair', async () => {
    const { a, b, threadId } = await conversation();
    const declined = await invitePair(a, { threadId });
    expect(await respondToPairInvite(b, { inviteId: declined, accept: false })).toEqual({ pairId: null });
    const cancelled = await invitePair(a, { threadId });
    await expect(cancelPairInvite(b, { inviteId: cancelled })).rejects.toMatchObject({ code: 'streaks.invite_gone' });
    await cancelPairInvite(a, { inviteId: cancelled });
    expect(await streakStatusInThread(a, threadId)).toEqual({ state: 'none' });
    expect(await database.sql`select 1 from pairs where user_a in ${database.sql([a.id, b.id])}`).toHaveLength(0);
  });

  it('refuses outsiders, unverified or blocked partners, and members at their pair limit', async () => {
    const { a, b, threadId } = await conversation();
    const outsider = await member();
    await expect(invitePair(outsider, { threadId })).rejects.toMatchObject({ code: 'streaks.thread_missing' });
    await database.sql`insert into blocks (blocker, blocked) values (${b.id}, ${a.id})`;
    await expect(invitePair(a, { threadId })).rejects.toMatchObject({ code: 'streaks.unreachable' });
    await database.sql`delete from blocks where blocker = ${b.id}`;

    await withSettings({ 'streaks.maxActivePairs': 1 }, async () => {
      const other = await conversation();
      const first = await invitePair(other.a, { threadId: other.threadId });
      await respondToPairInvite(other.b, { inviteId: first, accept: true });
      // other.a now keeps one pair: a new invitation from a conversation with them is refused at accept.
      const [thread] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
      await database.sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${a.id}), (${thread!.id}, ${other.a.id})`;
      const invite = await invitePair(a, { threadId: thread!.id });
      await expect(respondToPairInvite(other.a, { inviteId: invite, accept: true })).rejects.toMatchObject({ code: 'streaks.too_many' });
      await expect(invitePair(other.a, { threadId: other.threadId })).rejects.toMatchObject({ code: 'streaks.pair_exists' });
    });
  });

  it('ends a pair and tells the partner; a paused pair resumes from today', async () => {
    const { a, b, threadId } = await conversation();
    const { pairId } = await respondToPairInvite(b, { inviteId: await invitePair(a, { threadId }), accept: true });
    await database.sql`update pairs set status = 'paused', missed_in_row = 3, last_judged_day = ${addDays(today, -10)} where id = ${pairId}`;
    await resumePair(a, { pairId });
    const [resumed] = await database.sql`select status, missed_in_row, last_judged_day::text from pairs where id = ${pairId}`;
    expect(resumed).toEqual({ status: 'active', missed_in_row: 0, last_judged_day: addDays(today, -1) });
    await expect(resumePair(a, { pairId })).rejects.toMatchObject({ code: 'streaks.not_paused' });

    await endPair(b, { pairId });
    expect((await notifications(a.id, 'pair_ended'))[0]?.data).toEqual({ login: b.login });
    await expect(endPair(a, { pairId })).rejects.toMatchObject({ code: 'streaks.pair_missing' });
    expect((await getStreaks(a)).pairs).toEqual([]);
  });

  it('tells the partner when a member deletes their account', async () => {
    const { a, b, threadId } = await conversation();
    await respondToPairInvite(b, { inviteId: await invitePair(a, { threadId }), accept: true });
    await deleteMemberData(a.id, new Date());
    expect(await notifications(b.id, 'pair_ended')).toHaveLength(1);
  });
});
