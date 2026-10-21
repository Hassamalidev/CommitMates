import { findSwapCycles, selectSwapCycles, swapEdges, teachLevels, type SwapOffer, type SwapWant } from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addConnection,
  blockedPairsAt,
  createThread,
  expireSwapProposals,
  getDb,
  getLogin,
  getProfileDetails,
  getSetting,
  insertMessage,
  insertNotification,
  insertSwapProposal,
  knownTags,
  lockSwapProposal,
  matchPool,
  membersInOpenProposals,
  offersOf,
  proposalsFor,
  recordSwapResponse,
  replaceSelfDeclaredOffers,
  replaceVerifiedOffers,
  replaceWants,
  setSwapProposalStatus,
  universitiesWithMembers,
  wantsOf,
  type PoolMember,
  type SwapProposalRow,
} from '@commitmates/db';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import { utcDay } from '../notifications/email';
import type { Member } from '../profiles/schemas';
import { campusUnlocks } from '../universities/campus';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Proposals shown on the Skill Swap page. */
export const SWAP_PROPOSALS_SHOWN = 20;

type Actor = Pick<Member, 'id' | 'verified' | 'universityId'>;

/** A verified member at a university where the Skill Swap is open (`unlock.swap.minMembers`). */
async function requireSwapOpen(actor: Actor): Promise<string> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('swap.verify_first', 'Verify your university to use the Skill Swap.');
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'swap');
  if (!unlock?.unlocked) throw new ForbiddenError('swap.locked', 'The Skill Swap opens once enough members of your university have joined.');
  return actor.universityId;
}

/** Verified offers: tags whose level within the university reaches `swap.minTeachLevel` (§8 F16 "Offers and wants"). */
function verifiedOffersFrom(pool: readonly PoolMember[], minTeachLevel: number): { userId: string; tag: string; level: number }[] {
  const levels = teachLevels(new Map(pool.map((member) => [member.userId, member.vector])));
  return [...levels.entries()].flatMap(([userId, tags]) =>
    [...tags.entries()].filter(([, level]) => level >= minTeachLevel).map(([tag, level]) => ({ userId, tag, level })),
  );
}

/** A member's wants: those added on the Skill Swap page, plus learning goals they did not rank (§8 F16). */
function effectiveWants(member: Pick<PoolMember, 'userId' | 'learningGoals'>, rows: readonly { tag: string; priority: number }[], goalPriority: number) {
  const ranked = new Map(rows.map((row) => [row.tag, row.priority]));
  for (const goal of member.learningGoals) if (!ranked.has(goal)) ranked.set(goal, goalPriority);
  return [...ranked.entries()].map(([tag, priority]) => ({ tag, priority }));
}

/**
 * Nightly proposals at one university (CLAUDE.md §8 F16 "Proposal generation"): proposals past their
 * deadline expire; verified offers are refreshed from the skill vectors; then, among members who are
 * visible and not in an open proposal, 2-cycles and (when `swap.maxCycleLength` allows) 3-cycles of
 * "offers what the next one wants" are found, never across a block, scored by mean edge quality
 * (self-declared offers count `swap.selfDeclaredFactor`), and chosen greedily without overlap.
 */
export async function proposeSwaps(universityId: string, now: Date): Promise<{ proposed: number; expired: number }> {
  const [minTeachLevel, selfDeclaredFactor, maxPriority, goalPriority, maxCycleLength, ttlDays] = await Promise.all([
    getSetting('swap.minTeachLevel'),
    getSetting('swap.selfDeclaredFactor'),
    getSetting('swap.maxPriority'),
    getSetting('swap.goalPriority'),
    getSetting('swap.maxCycleLength'),
    getSetting('swap.proposalTtlDays'),
  ]);
  const expired = await expireSwapProposals(universityId, now);
  const pool = await matchPool(universityId);
  await getDb().transaction((tx) => replaceVerifiedOffers(pool.map((member) => member.userId), verifiedOffersFrom(pool, minTeachLevel), tx));

  const busy = await membersInOpenProposals(universityId);
  const eligible = pool.filter((member) => !member.invisible && !busy.has(member.userId));
  const ids = eligible.map((member) => member.userId);
  const [offerRows, wantRows, blocked] = await Promise.all([offersOf(ids), wantsOf(ids), blockedPairsAt(universityId)]);
  const offers: SwapOffer[] = offerRows.map((row) => ({ member: row.userId, tag: row.tag, level: row.level, verified: row.verified }));
  const wants: SwapWant[] = eligible.flatMap((member) =>
    effectiveWants(
      member,
      wantRows.filter((row) => row.userId === member.userId),
      goalPriority,
    ).map((want) => ({ member: member.userId, tag: want.tag, priority: Math.min(1, want.priority / maxPriority) })),
  );
  const edges = swapEdges(offers, wants, { selfDeclaredFactor, allowed: (a, b) => !blocked.has(`${a}|${b}`) });
  const chosen = selectSwapCycles(findSwapCycles(edges, maxCycleLength));

  const expiresAt = new Date(now.getTime() + ttlDays * MS_PER_DAY);
  for (const cycle of chosen) {
    const id = await insertSwapProposal(
      { universityId, members: cycle.members, edges: cycle.edges.map((edge) => ({ from: edge.from, to: edge.to, tag: edge.tag })), quality: cycle.score, expiresAt },
      getDb(),
    );
    for (const member of cycle.members) await insertNotification(member, 'swap_proposed', { proposalId: id, size: cycle.members.length });
  }
  return { proposed: chosen.length, expired: expired.length };
}

const proposePayloadSchema = z.union([z.object({ universityId: z.uuid() }), z.object({})]);

/** `propose_swaps` (CLAUDE.md §5.4): the nightly run queues one run per university where the Skill Swap is open. */
export const proposeSwapsJob: JobHandler<z.infer<typeof proposePayloadSchema>> = {
  type: 'propose_swaps',
  schema: proposePayloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const now = ctx.now();
    if (!('universityId' in payload)) {
      const universities = await universitiesWithMembers(await getSetting('unlock.swap.minMembers'));
      for (const universityId of universities) {
        await enqueue('propose_swaps', { universityId }, { idempotencyKey: `swaps:${universityId}:${utcDay(now)}`, priority: PRIORITY.MAINTENANCE });
      }
      return { kind: 'done', resultRef: { queued: universities.length } };
    }
    return { kind: 'done', resultRef: await proposeSwaps(payload.universityId, now) };
  },
};

/** Tags as the vocabulary spells them: lowercase, hyphenated (§6.6); unknown or empty ones dropped by the caller. */
const tagsFrom = (raw: readonly string[]) => [...new Set(raw.flatMap((tag) => normalizeTag(tag) ?? []))];

async function requireKnown(tags: readonly string[], field: string): Promise<void> {
  const known = await knownTags(tags);
  const unknown = tags.filter((tag) => !known.has(tag));
  if (unknown.length > 0) throw new ValidationError('swap.unknown_tags', `We don't know these skills yet: ${unknown.join(', ')}.`, { field });
}

export const setOffersSchema = z.object({ selfDeclared: z.array(z.string()) });

/**
 * A member's self-declared offers (§8 F16 "Offers and wants"): skills their code does not show yet,
 * shown with a "self-declared" badge and weighted lower in proposals. Tags already verified stay so.
 */
export async function setOffers(actor: Actor, raw: unknown): Promise<string[]> {
  const universityId = await requireSwapOpen(actor);
  const tags = tagsFrom(setOffersSchema.parse(raw).selfDeclared);
  const [maxSelfDeclared, minTeachLevel] = await Promise.all([getSetting('swap.maxSelfDeclared'), getSetting('swap.minTeachLevel')]);
  if (tags.length > maxSelfDeclared) throw new ValidationError('swap.too_many_offers', `Offer at most ${maxSelfDeclared} self-declared skills.`, { field: 'selfDeclared' });
  await requireKnown(tags, 'selfDeclared');
  const verified = new Set(verifiedOffersFrom(await matchPool(universityId), minTeachLevel).filter((offer) => offer.userId === actor.id).map((offer) => offer.tag));
  const declared = tags.filter((tag) => !verified.has(tag));
  await replaceSelfDeclaredOffers(actor.id, declared, minTeachLevel);
  return declared;
}

export const setWantsSchema = z.object({ wants: z.array(z.object({ tag: z.string(), priority: z.coerce.number().int() })) });

/** The skills a member wants to learn, each with a priority from 1 to `swap.maxPriority` (§8 F16). */
export async function setWants(actor: Actor, raw: unknown): Promise<void> {
  await requireSwapOpen(actor);
  const [maxPriority, maxWants] = await Promise.all([getSetting('swap.maxPriority'), getSetting('swap.maxWants')]);
  const byTag = new Map<string, number>();
  for (const want of setWantsSchema.parse(raw).wants) {
    const tag = normalizeTag(want.tag);
    if (tag === null) continue;
    if (want.priority < 1 || want.priority > maxPriority) throw new ValidationError('swap.priority', `Pick a priority from 1 to ${maxPriority}.`, { field: 'wants' });
    byTag.set(tag, want.priority);
  }
  if (byTag.size > maxWants) throw new ValidationError('swap.too_many_wants', `Pick at most ${maxWants} skills to learn.`, { field: 'wants' });
  await requireKnown([...byTag.keys()], 'wants');
  await replaceWants(actor.id, [...byTag.entries()].map(([tag, priority]) => ({ tag, priority })));
}

export type SwapView = {
  verifiedOffers: { tag: string; level: number }[];
  selfDeclared: string[];
  wants: { tag: string; priority: number; fromGoals: boolean }[];
  proposals: (SwapProposalRow & { logins: Record<string, string | null> })[];
  rules: { maxPriority: number; maxSelfDeclared: number; maxWants: number; minTeachLevel: number };
};

/** Everything the Skill Swap page shows: offers (verified now, from the vectors), wants and proposals. */
export async function getSwaps(actor: Actor): Promise<SwapView> {
  const universityId = await requireSwapOpen(actor);
  const [minTeachLevel, maxPriority, goalPriority, maxSelfDeclared, maxWants] = await Promise.all([
    getSetting('swap.minTeachLevel'),
    getSetting('swap.maxPriority'),
    getSetting('swap.goalPriority'),
    getSetting('swap.maxSelfDeclared'),
    getSetting('swap.maxWants'),
  ]);
  const [pool, offers, wantRows, proposals, details] = await Promise.all([
    matchPool(universityId),
    offersOf([actor.id]),
    wantsOf([actor.id]),
    proposalsFor(actor.id, SWAP_PROPOSALS_SHOWN),
    getProfileDetails(actor.id),
  ]);
  const learningGoals = details?.learningGoals ?? [];
  const verifiedOffers = verifiedOffersFrom(pool, minTeachLevel)
    .filter((offer) => offer.userId === actor.id)
    .map(({ tag, level }) => ({ tag, level }))
    .sort((a, b) => b.level - a.level || a.tag.localeCompare(b.tag));
  const verified = new Set(verifiedOffers.map((offer) => offer.tag));
  const ranked = new Set(wantRows.map((row) => row.tag));
  const wants = [
    ...wantRows.map((row) => ({ tag: row.tag, priority: row.priority, fromGoals: false })),
    ...learningGoals.filter((goal) => !ranked.has(goal)).map((tag) => ({ tag, priority: goalPriority, fromGoals: true })),
  ];
  const memberIds = [...new Set(proposals.flatMap((proposal) => proposal.members))];
  const logins = Object.fromEntries(await Promise.all(memberIds.map(async (id) => [id, await getLogin(id)] as const)));
  return {
    verifiedOffers,
    selfDeclared: offers.filter((offer) => !offer.verified && !verified.has(offer.tag)).map((offer) => offer.tag),
    wants,
    proposals: proposals.map((proposal) => ({ ...proposal, logins })),
    rules: { maxPriority, maxSelfDeclared, maxWants, minTeachLevel },
  };
}

/** Prefix of the system message that opens a swap's group thread. */
export const SWAP_NOTE_PREFIX = 'swap:';

/**
 * The system message of a swap's group thread (§8 F16 "Accepting"): who helps whom with what, as data
 * the chat view words (system messages are keys, like the other notes), with logins at that moment.
 */
export function swapNote(edges: readonly { from: string; to: string; tag: string }[], logins: Readonly<Record<string, string | null>>): string {
  return SWAP_NOTE_PREFIX + JSON.stringify(edges.map((edge) => ({ from: logins[edge.from] ?? null, to: logins[edge.to] ?? null, tag: edge.tag })));
}

export const respondSchema = z.object({ proposalId: z.uuid(), response: z.enum(['accept', 'decline']) });

/**
 * A member's answer to a proposal (§8 F16 "Accepting"). Once every member accepts, a `swap` group
 * thread opens with a system message saying who helps whom, and the members are connected; one
 * decline ends the proposal, and its members return to the pool the next night.
 */
export async function respondToProposal(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<{ status: 'proposed' | 'accepted' | 'declined'; threadId: string | null }> {
  const { proposalId, response } = respondSchema.parse(raw);
  const outcome = await getDb().transaction(async (tx) => {
    const proposal = await lockSwapProposal(proposalId, tx);
    if (!proposal?.members.includes(actor.id)) throw new NotFoundError('swap.not_yours', 'That proposal is not yours.');
    if (proposal.status !== 'proposed') throw new ValidationError('swap.closed', 'That proposal is no longer open.');
    if (proposal.expiresAt <= now) {
      // Recorded before refusing: throwing here would roll the update back.
      await setSwapProposalStatus(proposalId, 'expired', tx);
      return { status: 'expired' as const, proposal, threadId: null };
    }
    const accepted = await recordSwapResponse(proposalId, actor.id, response, now, tx);
    if (response === 'decline') {
      await setSwapProposalStatus(proposalId, 'declined', tx);
      return { status: 'declined' as const, proposal, threadId: null };
    }
    if (!proposal.members.every((member) => accepted.includes(member))) return { status: 'proposed' as const, proposal, threadId: null };
    await setSwapProposalStatus(proposalId, 'accepted', tx);
    const logins = Object.fromEntries(await Promise.all(proposal.members.map(async (id) => [id, await getLogin(id, tx)] as const)));
    const threadId = await createThread('swap', proposal.members, null, tx);
    await insertMessage({ threadId, authorUserId: null, kind: 'system', body: swapNote(proposal.edges, logins) }, tx);
    for (const [index, a] of proposal.members.entries()) for (const b of proposal.members.slice(index + 1)) await addConnection(a, b, 'swap', tx);
    return { status: 'accepted' as const, proposal, threadId };
  });
  if (outcome.status === 'expired') throw new ValidationError('swap.closed', 'That proposal is no longer open.');
  const others = outcome.proposal.members.filter((member) => member !== actor.id);
  if (outcome.status === 'declined') for (const member of others) await insertNotification(member, 'swap_declined', { proposalId });
  if (outcome.status === 'accepted') for (const member of outcome.proposal.members) await insertNotification(member, 'swap_accepted', { proposalId, threadId: outcome.threadId });
  return { status: outcome.status, threadId: outcome.threadId };
}
