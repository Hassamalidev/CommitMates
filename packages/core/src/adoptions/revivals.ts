import {
  NotFoundError,
  getSetting,
  getTrackedAdoption,
  insertNotification,
  markAdoptionDropped,
  markAdoptionRevived,
  recordDetectedFork,
  relistDroppedListing,
  trackableAdoptionIds,
  type TrackedAdoption,
} from '@commitmates/db';
import {
  GitHubNotFoundError,
  SERVER_IDENTITY,
  fetchRepositoryById,
  githubFor,
  listCommits,
  listForks,
  parseGitHubUrl,
  type GitHubClient,
} from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { utcDay } from '../notifications/email';
import type { Member } from '../profiles/schemas';
import { getMember } from '../profiles/service';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion

const payloadSchema = z.union([z.object({ adoptionId: z.uuid() }), z.object({})]);
type RevivalPayload = z.infer<typeof payloadSchema>;

type Outcome = 'waiting' | 'fork_found' | 'revived' | 'dropped' | 'untracked';

const splitName = (fullName: string) => parseGitHubUrl(fullName);

/** The adopter's own token when it is valid; public reads otherwise go through the server token. */
async function clientFor(adopterUserId: string, now: () => Date): Promise<GitHubClient> {
  const adopter = await getMember(adopterUserId);
  return githubFor(adopter?.hasValidToken ? { kind: 'user', userId: adopterUserId } : SERVER_IDENTITY, { now });
}

/** The repository's current name: from our cache, else by id (it may have been renamed). Null once it is gone. */
async function repositoryName(client: GitHubClient, adoption: TrackedAdoption, deadline: number): Promise<string | null> {
  if (adoption.repoFullName) return adoption.repoFullName;
  try {
    return (await fetchRepositoryById(client, adoption.repoGithubId, { deadline })).fullName;
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}

/** The adopter's fork among the repository's forks (§8 F14 step 3), newest first. */
async function findFork(client: GitHubClient, repoFullName: string | null, adopterLogin: string | null, deadline: number): Promise<string | null> {
  const ref = repoFullName ? splitName(repoFullName) : null;
  if (!ref || !adopterLogin) return null;
  try {
    const { forks } = await listForks(client, ref.owner, ref.repo, { deadline });
    return forks.find((fork) => fork.ownerLogin.toLowerCase() === adopterLogin.toLowerCase())?.fullName ?? null;
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}

/** Commits on the fork since the adoption began, newest first, up to `limit`. None when the fork is gone. */
async function forkCommits(client: GitHubClient, fork: string, since: Date, limit: number, deadline: number): Promise<{ count: number; latest: Date | null }> {
  const ref = splitName(fork);
  if (!ref) return { count: 0, latest: null };
  try {
    const { commits } = await listCommits(client, ref.owner, ref.repo, { limit, since: since.toISOString(), deadline });
    const latest = commits[0]?.date;
    return { count: commits.length, latest: latest ? new Date(latest) : null };
  } catch (error) {
    if (error instanceof GitHubNotFoundError) return { count: 0, latest: null };
    throw error;
  }
}

async function notifyBoth(adoption: TrackedAdoption, kind: 'adoption_revived' | 'adoption_dropped', repo: string | null, fork: string | null): Promise<void> {
  const data = { repo: repo ?? '', fork: fork ?? '' };
  await insertNotification(adoption.adopterUserId, kind, { ...data, role: 'adopter' });
  if (adoption.ownerUserId) await insertNotification(adoption.ownerUserId, kind, { ...data, role: 'owner' });
}

/**
 * One adoption's daily check (CLAUDE.md §8 F14 "Revival tracking"):
 * - asked through a listing: dropped once the owner declined or the request expired;
 * - asked from a global result: active once the adopter's fork appears among the repository's forks;
 * - active: the fork (linked, or found the same way) is revived at `adoptions.reviveMinCommits`
 *   commits since the adoption began; with no commit for `adoptions.dropAfterDays` it is dropped;
 * - anything still only asked for after `adoptions.dropAfterDays` is dropped quietly.
 * Revivals and drops of adoptions that were under way notify the adopter and the owner.
 */
export async function trackAdoption(adoptionId: string, options: { now: () => Date; deadline: number }): Promise<Outcome> {
  const adoption = await getTrackedAdoption(adoptionId);
  if (adoption?.status !== 'requested' && adoption?.status !== 'active') return 'untracked';
  const now = options.now();
  const [reviveMinCommits, dropAfterDays] = await Promise.all([getSetting('adoptions.reviveMinCommits'), getSetting('adoptions.dropAfterDays')]);
  const stale = (since: Date) => now.getTime() - since.getTime() > dropAfterDays * MS_PER_DAY;

  if (adoption.status === 'requested' && adoption.listingId !== null) {
    // Only the owner starts a listing adoption; a declined or expired request ends it.
    if (adoption.requestStatus === 'declined' || adoption.requestStatus === 'expired' || (adoption.requestStatus === null && stale(adoption.createdAt))) {
      return (await markAdoptionDropped(adoption.id)) ? 'dropped' : 'untracked';
    }
    return 'waiting';
  }

  const client = await clientFor(adoption.adopterUserId, options.now);
  const repo = await repositoryName(client, adoption, options.deadline);
  let fork = adoption.forkFullName;
  if (fork === null) {
    fork = await findFork(client, repo, adoption.adopterLogin, options.deadline);
    if (fork !== null) await recordDetectedFork(adoption.id, fork);
  }
  if (fork === null) {
    if (stale(adoption.activatedAt ?? adoption.createdAt)) {
      if (!(await markAdoptionDropped(adoption.id))) return 'untracked';
      if (adoption.status === 'active') await notifyBoth(adoption, 'adoption_dropped', repo, null);
      return 'dropped';
    }
    return 'waiting';
  }

  const commits = await forkCommits(client, fork, adoption.createdAt, reviveMinCommits, options.deadline);
  if (commits.count >= reviveMinCommits) {
    if (!(await markAdoptionRevived(adoption.id, now))) return 'untracked';
    await notifyBoth(adoption, 'adoption_revived', repo, fork);
    return 'revived';
  }
  const activeSince = adoption.activatedAt ?? now;
  const lastActivity = commits.latest && commits.latest > activeSince ? commits.latest : activeSince;
  if (stale(lastActivity)) {
    if (!(await markAdoptionDropped(adoption.id))) return 'untracked';
    await notifyBoth(adoption, 'adoption_dropped', repo, fork);
    return 'dropped';
  }
  return adoption.forkFullName === null ? 'fork_found' : 'waiting';
}

/**
 * `track_revivals` (CLAUDE.md §5.4): the daily scheduled run queues one check per adoption that is
 * asked for or under way, once per adoption and UTC day; each check is `trackAdoption`.
 */
export const trackRevivalsJob: JobHandler<RevivalPayload> = {
  type: 'track_revivals',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    if (!('adoptionId' in payload)) {
      const day = utcDay(ctx.now());
      const ids = await trackableAdoptionIds();
      for (const adoptionId of ids) {
        await enqueue('track_revivals', { adoptionId }, { idempotencyKey: `revival:${adoptionId}:${day}`, priority: PRIORITY.MAINTENANCE });
      }
      return { kind: 'done', resultRef: { queued: ids.length } };
    }
    const outcome = await trackAdoption(payload.adoptionId, { now: ctx.now, deadline: ctx.deadline });
    return { kind: 'done', resultRef: { outcome } };
  },
};

export const relistSchema = z.object({ listingId: z.uuid() });

/** Puts an adopted project back up for adoption after its adoption was dropped (§8 F14 "if the owner agrees"). */
export async function relistRepo(actor: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  const { listingId } = relistSchema.parse(raw);
  if (!(await relistDroppedListing(actor.id, listingId))) {
    throw new NotFoundError('listings.not_dropped', 'That project can be listed again once its adoption has ended.');
  }
}
