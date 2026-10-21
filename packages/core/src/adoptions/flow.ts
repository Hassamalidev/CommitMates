import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  getDb,
  getListingForAdoption,
  hasOpenAdoption,
  insertAdoption,
  memberAdoptions,
  memberListings,
  setAdoptionFork,
  type AdoptionView,
  type ListingView,
} from '@commitmates/db';
import { parseGitHubUrl } from '@commitmates/github';
import { z } from 'zod';

import { createRequestInTx, loadRequestRules } from '../chat/service';
import type { Member } from '../profiles/schemas';

type Actor = Pick<Member, 'id' | 'login' | 'verified' | 'universityId'>;

const verifiedOnly = (actor: Actor) => {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('adoptions.verify_first', 'Verify your university to adopt projects.');
};

export const requestAdoptionSchema = z.object({ listingId: z.uuid(), message: z.string() });

/**
 * Asks to adopt a project listed at the member's university (CLAUDE.md §8 F14 "Adoption flow" step 1):
 * an `adoptions` row and a message request to the owner with the adoption as its context, in one
 * transaction. The chat rules apply (blocks, ghost mode, first-message length, daily limit).
 */
export async function requestAdoption(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  verifiedOnly(actor);
  const input = requestAdoptionSchema.parse(raw);
  const listing = await getListingForAdoption(input.listingId);
  if (listing?.status !== 'listed' || listing.universityId !== actor.universityId) {
    throw new NotFoundError('adoptions.listing_gone', 'That project is no longer up for adoption here.');
  }
  if (listing.ownerUserId === actor.id) throw new ValidationError('adoptions.own', 'This is your own project.');
  if (await hasOpenAdoption(actor.id, listing.repoGithubId)) {
    throw new ConflictError('adoptions.already_requested', 'You already asked to adopt this project.');
  }
  const rules = await loadRequestRules();
  return getDb().transaction(async (tx) => {
    const adoptionId = await insertAdoption({ listingId: listing.id, repoGithubId: listing.repoGithubId, adopterUserId: actor.id }, tx);
    await createRequestInTx(
      tx,
      actor.id,
      { toUserId: listing.ownerUserId, message: input.message, contextKind: 'adoption', contextId: adoptionId, icebreakerKey: null },
      now,
      rules,
    );
    return adoptionId;
  });
}

export const adoptionInterestSchema = z.object({ repoGithubId: z.coerce.number().int().positive() });

/**
 * A member forking or asking about a project found in the global Graveyard (§8 F7 "Members: the click
 * also records an adoptions row"), so a later revival can be tracked. One open record per repository.
 */
export async function recordAdoptionInterest(actor: Actor, raw: unknown): Promise<boolean> {
  verifiedOnly(actor);
  const { repoGithubId } = adoptionInterestSchema.parse(raw);
  if (await hasOpenAdoption(actor.id, repoGithubId)) return false;
  await insertAdoption({ listingId: null, repoGithubId, adopterUserId: actor.id });
  return true;
}

export const linkForkSchema = z.object({ adoptionId: z.uuid(), fork: z.string().trim().min(1) });

/** Links the fork an adopter works in (§8 F14 step 3); it must be in their own GitHub account. */
export async function linkFork(actor: Actor, raw: unknown): Promise<string> {
  const input = linkForkSchema.parse(raw);
  const ref = parseGitHubUrl(input.fork);
  if (ref?.number !== undefined || ref === null) throw new ValidationError('adoptions.fork_invalid', 'Paste your fork as owner/name or its GitHub link.', { field: 'fork' });
  if (ref.owner.toLowerCase() !== actor.login?.toLowerCase()) {
    throw new ValidationError('adoptions.fork_not_yours', 'Link the fork in your own GitHub account.', { field: 'fork' });
  }
  const fullName = `${ref.owner}/${ref.repo}`;
  if (!(await setAdoptionFork(input.adoptionId, actor.id, fullName))) {
    throw new NotFoundError('adoptions.not_active', 'Link a fork once the owner has accepted your adoption.');
  }
  return fullName;
}

export type AdoptionsOverview = { adopting: AdoptionView[]; adoptedFromMe: ListingView[] };

/** The adoptions a member asked for, and their own listings others adopted (for the license prompt). */
export async function getAdoptions(actor: Pick<Member, 'id'>): Promise<AdoptionsOverview> {
  const [adopting, listings] = await Promise.all([memberAdoptions(actor.id), memberListings(actor.id)]);
  return { adopting, adoptedFromMe: listings.filter((listing) => listing.status === 'adopted') };
}
