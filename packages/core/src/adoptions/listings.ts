import { monthsBetween, termMatcher } from '@commitmates/algorithms';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  addListingSuggestion,
  dismissListingSuggestion,
  getSetting,
  insertListing,
  memberListings,
  memberOwnRepos,
  openListingSuggestions,
  settledRepoIds,
  verifiedMembersWithGithub,
  withdrawListing,
} from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { repoSignals, unfinishedFromSignals } from '../graveyard/signals';
import { utcDay } from '../notifications/email';
import type { Member } from '../profiles/schemas';
import { getMember } from '../profiles/service';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
const DAYS_PER_WEEK = 7; // allowed-literal: unit conversion
/** Time kept in hand before the deadline; the rest of a member's repositories continue in a follow-up. */
const DEADLINE_MARGIN_MS = 4000;

type Actor = Pick<Member, 'id' | 'githubId' | 'verified'>;

/** The Monday (UTC) of the week `now` falls in, as `YYYY-MM-DD`. */
export const weekStart = (now: Date): string => utcDay(new Date(now.getTime() - ((now.getUTCDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK) * MS_PER_DAY));

const payloadSchema = z.union([z.object({ userId: z.uuid(), remaining: z.array(z.number()).optional() }), z.object({})]);
type SuggestPayload = z.infer<typeof payloadSchema>;

/**
 * Weekly private suggestions (CLAUDE.md §8 F14 "Private suggestions"): a member's own repositories that
 * are not forks, idle past `graveyard.idleMonths.default`, have a README and at least
 * `graveyard.minCommits` commits, and score at least `adoptions.suggestMinUnfinished` unfinished
 * (the F7 signals), unless already listed or dismissed. Only the owner ever sees them.
 */
export const suggestListingsJob: JobHandler<SuggestPayload> = {
  type: 'suggest_listings',
  schema: payloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const now = ctx.now();
    if (!('userId' in payload)) {
      const members = await verifiedMembersWithGithub();
      const week = weekStart(now);
      for (const { userId } of members) {
        await enqueue('suggest_listings', { userId }, { idempotencyKey: `listings:${userId}:${week}`, priority: PRIORITY.USER_BG });
      }
      return { kind: 'done', resultRef: { queued: members.length } };
    }

    const member = await getMember(payload.userId);
    if (!member?.verified || member.githubId === null) return { kind: 'done', resultRef: { skipped: true } };
    const [idleMonths, minCommits, minUnfinished, terms, settled, repos] = await Promise.all([
      getSetting('graveyard.idleMonths.default'),
      getSetting('graveyard.minCommits'),
      getSetting('adoptions.suggestMinUnfinished'),
      getSetting('graveyard.unfinishedTerms'),
      settledRepoIds(member.id),
      memberOwnRepos(member.githubId),
    ]);
    const candidates =
      payload.remaining ??
      repos.filter((repo) => !settled.has(repo.githubId) && repo.pushedAt !== null && monthsBetween(repo.pushedAt, now) >= idleMonths).map((repo) => repo.githubId);
    const byId = new Map(repos.map((repo) => [repo.githubId, repo]));
    const client = githubFor(member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY, { now: ctx.now });
    const unfinishedTerms = termMatcher(terms);
    let suggested = 0;
    for (const [index, repoId] of candidates.entries()) {
      if (Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) return { kind: 'continue', payload: { userId: member.id, remaining: candidates.slice(index) } };
      const repo = byId.get(repoId);
      if (!repo) continue;
      const signals = await repoSignals(client, repo.fullName, now, ctx.deadline);
      if (!signals.hasReadme || signals.commitEstimate < minCommits) continue;
      if (unfinishedFromSignals(signals, unfinishedTerms).score < minUnfinished) continue;
      if (await addListingSuggestion(member.id, repoId, now)) suggested += 1;
    }
    return { kind: 'done', resultRef: { checked: candidates.length, suggested } };
  },
};

function requireListing(actor: Actor): number {
  if (!actor.verified || actor.githubId === null) throw new ValidationError('listings.verify_first', 'Verify your university to list projects for adoption.');
  return actor.githubId;
}

/** The owner's listings, private suggestions, and other own repositories they could list. */
export async function getProjects(actor: Actor) {
  const githubId = requireListing(actor);
  const [listings, suggestions, repos, settled, noteMaxChars] = await Promise.all([
    memberListings(actor.id),
    openListingSuggestions(actor.id),
    memberOwnRepos(githubId),
    settledRepoIds(actor.id),
    getSetting('adoptions.noteMaxChars'),
  ]);
  const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.githubId));
  return { listings, suggestions, others: repos.filter((repo) => !settled.has(repo.githubId) && !suggestedIds.has(repo.githubId)), noteMaxChars };
}

export const listRepoSchema = z.object({ repoGithubId: z.coerce.number().int().positive(), note: z.string().trim().default('') });

/** Lists one of the owner's own repositories for adoption at their university (§8 F14 "Listing"). */
export async function listRepo(actor: Actor, raw: unknown): Promise<string> {
  const githubId = requireListing(actor);
  const input = listRepoSchema.parse(raw);
  const [repos, maxChars] = await Promise.all([memberOwnRepos(githubId), getSetting('adoptions.noteMaxChars')]);
  if (!repos.some((repo) => repo.githubId === input.repoGithubId)) {
    throw new NotFoundError('listings.not_yours', 'You can only list your own repositories.');
  }
  if (input.note.length > maxChars) throw new ValidationError('listings.note_long', `Keep the note to ${maxChars} characters.`, { field: 'note' });
  const id = await insertListing(actor.id, input.repoGithubId, input.note === '' ? null : input.note);
  if (id === null) throw new ConflictError('listings.already_listed', 'This repository is already up for adoption.');
  return id;
}

export const listingIdSchema = z.object({ listingId: z.uuid() });

export async function withdrawRepo(actor: Actor, raw: unknown): Promise<void> {
  const { listingId } = listingIdSchema.parse(raw);
  if (!(await withdrawListing(actor.id, listingId))) throw new NotFoundError('listings.not_listed', 'That listing is not open.');
}

export const dismissSchema = z.object({ repoGithubId: z.coerce.number().int().positive() });

/** Hides a suggestion for good; it is never suggested again. */
export async function dismissSuggestion(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const { repoGithubId } = dismissSchema.parse(raw);
  if (!(await dismissListingSuggestion(actor.id, repoGithubId, now))) throw new NotFoundError('listings.no_suggestion', 'That suggestion is gone.');
}
