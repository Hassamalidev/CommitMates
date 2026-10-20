import { randomUUID } from 'node:crypto';

import { addDays, seedFrom } from '@commitmates/algorithms';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  countActivePairs,
  createPair,
  endPairRow,
  getChatParticipant,
  getDb,
  getLogin,
  getSetting,
  getThread,
  insertNotification,
  insertPairInvite,
  isBlockedEitherWay,
  listPairDays,
  listPairViews,
  listPendingInvites,
  listThreadMembers,
  lockPair,
  lockPairInvite,
  openPairBetween,
  pendingInviteBetween,
  resumePairRow,
  setPairInviteStatus,
  type PairView,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

import { firstPairDay } from './judge';

type Actor = Pick<Member, 'id'>;

/** Days of history a pair card shows (CLAUDE.md §8 F13 "UI": a 30-day strip). */
export const STRIP_DAYS = 30;

const unreachable = () => new ForbiddenError('streaks.unreachable', "You can't start a streak with this person right now.");

/** The direct thread's other member, when the actor is in it. */
async function partnerInThread(actor: Actor, threadId: string): Promise<string> {
  const [thread, members] = await Promise.all([getThread(threadId), listThreadMembers(threadId)]);
  if (thread?.kind !== 'direct' || !members.some((member) => member.userId === actor.id)) {
    throw new NotFoundError('streaks.thread_missing', 'Start a streak from one of your conversations.');
  }
  const partner = members.find((member) => member.userId !== actor.id);
  if (!partner) throw new NotFoundError('streaks.thread_missing', 'Start a streak from one of your conversations.');
  return partner.userId;
}

async function underPairLimit(userId: string, max: number): Promise<boolean> {
  return (await countActivePairs(userId)) < max;
}

export const inviteSchema = z.object({ threadId: z.uuid() });

/**
 * Invites the other member of a direct conversation to a shared streak (CLAUDE.md §8 F13 "Pairing"):
 * both active and verified, neither blocked, no pair or pending invite between them yet, and the
 * inviter below `streaks.maxActivePairs`.
 */
export async function invitePair(actor: Actor, raw: unknown): Promise<string> {
  const { threadId } = inviteSchema.parse(raw);
  const partnerId = await partnerInThread(actor, threadId);
  const [me, partner, blocked, open, pending, max] = await Promise.all([
    getChatParticipant(actor.id),
    getChatParticipant(partnerId),
    isBlockedEitherWay(actor.id, partnerId),
    openPairBetween(actor.id, partnerId),
    pendingInviteBetween(actor.id, partnerId),
    getSetting('streaks.maxActivePairs'),
  ]);
  if (!me?.verified || me.status !== 'active' || !partner?.verified || partner.status !== 'active' || blocked) throw unreachable();
  if (open) throw new ConflictError('streaks.pair_exists', 'You already share a streak with this person.');
  if (pending) {
    throw new ConflictError(
      'streaks.invite_pending',
      pending.fromUser === actor.id ? 'Your invitation is waiting for an answer.' : 'They already invited you. Answer it on your streaks page.',
    );
  }
  if (!(await underPairLimit(actor.id, max))) {
    throw new RateLimitedError('streaks.too_many', `You can keep up to ${max} shared streaks at once. End one to start another.`, 0);
  }
  const inviteId = await insertPairInvite({ threadId, fromUser: actor.id, toUser: partnerId });
  if (inviteId === null) throw new ConflictError('streaks.invite_pending', 'Your invitation is waiting for an answer.');
  await insertNotification(partnerId, 'pair_invite', { login: await getLogin(actor.id) });
  return inviteId;
}

export const respondInviteSchema = z.object({ inviteId: z.uuid(), accept: z.boolean() });

/** Accepts or declines an invitation; accepting starts the pair and tells the inviter. */
export async function respondToPairInvite(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ pairId: string | null }> {
  const { inviteId, accept } = respondInviteSchema.parse(raw);
  const max = await getSetting('streaks.maxActivePairs');
  return getDb().transaction(async (tx) => {
    const invite = await lockPairInvite(inviteId, tx);
    if (invite?.toUser !== actor.id || invite.status !== 'pending') throw new NotFoundError('streaks.invite_gone', 'That invitation is no longer waiting.');
    if (!accept) {
      await setPairInviteStatus(invite.id, 'declined', now, tx);
      return { pairId: null };
    }
    if (await isBlockedEitherWay(invite.fromUser, actor.id, tx)) throw unreachable();
    if (await openPairBetween(invite.fromUser, actor.id, tx)) throw new ConflictError('streaks.pair_exists', 'You already share a streak with this person.');
    const [mine, theirs] = await Promise.all([countActivePairs(actor.id, tx), countActivePairs(invite.fromUser, tx)]);
    if (mine >= max || theirs >= max) {
      throw new RateLimitedError('streaks.too_many', `Each member can keep up to ${max} shared streaks at once.`, 0);
    }
    // The pair companion is seeded by the pair id (CLAUDE.md §9.5 "Seeds").
    const pairId = randomUUID();
    await createPair(pairId, invite.fromUser, actor.id, seedFrom(pairId), tx);
    await setPairInviteStatus(invite.id, 'accepted', now, tx);
    await insertNotification(invite.fromUser, 'pair_accepted', { login: await getLogin(actor.id, tx) }, tx);
    return { pairId };
  });
}

export const cancelInviteSchema = z.object({ inviteId: z.uuid() });

/** Withdraws the actor's own pending invitation. */
export async function cancelPairInvite(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const { inviteId } = cancelInviteSchema.parse(raw);
  await getDb().transaction(async (tx) => {
    const invite = await lockPairInvite(inviteId, tx);
    if (invite?.fromUser !== actor.id || invite.status !== 'pending') throw new NotFoundError('streaks.invite_gone', 'That invitation is no longer waiting.');
    await setPairInviteStatus(invite.id, 'cancelled', now, tx);
  });
}

export const pairActionSchema = z.object({ pairId: z.uuid() });

/** A pair the actor belongs to, locked. */
async function ownPair(actor: Actor, pairId: string, tx: Parameters<typeof lockPair>[1]) {
  const pair = await lockPair(pairId, tx);
  if (!pair || (pair.userA !== actor.id && pair.userB !== actor.id) || pair.status === 'ended') {
    throw new NotFoundError('streaks.pair_missing', 'That streak has ended or is not yours.');
  }
  return pair;
}

/** Ends a pair; the partner is told. */
export async function endPair(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const { pairId } = pairActionSchema.parse(raw);
  await getDb().transaction(async (tx) => {
    const pair = await ownPair(actor, pairId, tx);
    await endPairRow(pair.id, now, tx);
    const partner = pair.userA === actor.id ? pair.userB : pair.userA;
    await insertNotification(partner, 'pair_ended', { login: await getLogin(actor.id, tx) }, tx);
  });
}

/**
 * Resumes a paused pair (after the check-in its pause suggested). Judging starts again with today:
 * the days it was paused are neither counted nor missed.
 */
export async function resumePair(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const { pairId } = pairActionSchema.parse(raw);
  const max = await getSetting('streaks.maxActivePairs');
  await getDb().transaction(async (tx) => {
    const pair = await ownPair(actor, pairId, tx);
    if (pair.status !== 'paused') throw new ValidationError('streaks.not_paused', 'This streak is not paused.');
    const [a, b] = await Promise.all([countActivePairs(pair.userA, tx), countActivePairs(pair.userB, tx)]);
    if (a >= max || b >= max) throw new RateLimitedError('streaks.too_many', `Each member can keep up to ${max} shared streaks at once.`, 0);
    await resumePairRow(pair.id, addDays(firstPairDay(now), -1), tx);
  });
}

export type StreakCard = PairView & { days: { day: string; outcome: 'counted' | 'frozen' | 'missed' }[] };

/** The member's streaks with the last days' outcomes, and invitations both ways (CLAUDE.md §8 F13). */
export async function getStreaks(actor: Actor, now: Date = new Date()): Promise<{ pairs: StreakCard[]; invites: Awaited<ReturnType<typeof listPendingInvites>> }> {
  const since = addDays(firstPairDay(now), -STRIP_DAYS);
  const [views, invites] = await Promise.all([listPairViews(actor.id), listPendingInvites(actor.id)]);
  const pairs = await Promise.all(
    views.map(async (view) => ({
      ...view,
      days: (await listPairDays(view.id, since)).map((row) => ({ day: row.day, outcome: row.outcome })),
    })),
  );
  return { pairs, invites };
}

/**
 * What a conversation can offer about streaks with its other member: start one, an invitation
 * waiting, or the pair that already exists.
 */
export async function streakStatusInThread(
  actor: Actor,
  threadId: string,
): Promise<{ state: 'none' } | { state: 'invited' } | { state: 'invitedYou' } | { state: 'paired' } | null> {
  const partnerId = await partnerInThread(actor, threadId).catch(() => null);
  if (partnerId === null) return null;
  const [open, pending] = await Promise.all([openPairBetween(actor.id, partnerId), pendingInviteBetween(actor.id, partnerId)]);
  if (open) return { state: 'paired' };
  if (pending) return { state: pending.fromUser === actor.id ? 'invited' : 'invitedYou' };
  return { state: 'none' };
}
