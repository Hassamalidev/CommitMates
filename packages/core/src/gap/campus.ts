import { teachLevels } from '@commitmates/algorithms';
import { ValidationError, blockedPairsAt, getLogin, getSetting, matchPool } from '@commitmates/db';
import { parseGitHubUrl } from '@commitmates/github';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import { createRequest } from '../chat/service';
import type { Member } from '../profiles/schemas';
import { campusUnlocks } from '../universities/campus';

type Actor = Pick<Member, 'id' | 'verified' | 'universityId'>;

export type GapHelper = { userId: string; login: string; level: number };
export type GapHelpers =
  | { state: 'open'; helpers: Record<string, GapHelper[]> }
  | { state: 'locked'; current: number; required: number }
  | { state: 'unverified' };

/** Most tags one request may ask about; the service keeps `gap.maxGaps` of them. Bounds the input only. */
const MAX_ASKED_TAGS = 100;

export const gapHelpersSchema = z.object({ tags: z.array(z.string()).max(MAX_ASKED_TAGS) });

/**
 * Who at the member's university can fill a gap (CLAUDE.md §8 F5 step 7): verified members whose
 * skill level in the gap's tag (percentile within the university, as for the Skill Swap) reaches
 * `swap.minTeachLevel`, best first, at most `gap.helpersPerGap` per tag. Never the member themself,
 * nobody hidden or in ghost mode, and nobody either side has blocked. Opens at `unlock.gapCampus.minMembers`.
 */
export async function gapHelpers(actor: Actor, raw: unknown): Promise<GapHelpers> {
  if (!actor.verified || actor.universityId === null) return { state: 'unverified' };
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'gapCampus');
  if (!unlock?.unlocked) return { state: 'locked', current: unlock?.current ?? 0, required: unlock?.required ?? 0 };
  const [maxGaps, perGap, minTeachLevel] = await Promise.all([getSetting('gap.maxGaps'), getSetting('gap.helpersPerGap'), getSetting('swap.minTeachLevel')]);
  // Keyed by the tags as asked for, so the page can look them up; matched in their vocabulary spelling.
  const asked = [...new Set(gapHelpersSchema.parse(raw).tags)].slice(0, maxGaps);
  const spelled = new Map(asked.flatMap((tag) => {
    const normalized = normalizeTag(tag);
    return normalized ? [[tag, normalized] as const] : [];
  }));
  const [pool, blocked] = await Promise.all([matchPool(actor.universityId), blockedPairsAt(actor.universityId)]);
  const levels = teachLevels(new Map(pool.map((member) => [member.userId, member.vector])));
  const visible = new Set(pool.filter((member) => !member.invisible && member.userId !== actor.id && !blocked.has(`${actor.id}|${member.userId}`)).map((member) => member.userId));

  const picked = Object.fromEntries(
    [...spelled.entries()].map(([asTagged, tag]) => [
      asTagged,
      [...levels.entries()]
        .flatMap(([userId, byTag]) => {
          const level = byTag.get(tag);
          return visible.has(userId) && level !== undefined && level >= minTeachLevel ? [{ userId, level }] : [];
        })
        .sort((a, b) => b.level - a.level || a.userId.localeCompare(b.userId))
        .slice(0, perGap),
    ]),
  );
  const ids = [...new Set(Object.values(picked).flatMap((list) => list.map((entry) => entry.userId)))];
  const logins = new Map(await Promise.all(ids.map(async (id) => [id, await getLogin(id)] as const)));
  const helpers = Object.fromEntries(
    Object.entries(picked).map(([tag, list]) => [tag, list.flatMap((entry) => (logins.get(entry.userId) ? [{ ...entry, login: logins.get(entry.userId) ?? '' }] : []))]),
  );
  return { state: 'open', helpers };
}

export const askGapHelperSchema = z.object({ toUserId: z.uuid(), repoFullName: z.string().trim().min(1), tag: z.string().trim().min(1), message: z.string() });

/**
 * "Ask" on a Gap Finder helper (§8 F5 step 7): a message request with `context_kind = 'gap'` and the
 * repository as its context, only to someone this member's Gap Finder would list for that tag. The
 * chat rules apply as for any request (§8 F12).
 */
export async function askGapHelper(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const input = askGapHelperSchema.parse(raw);
  const ref = parseGitHubUrl(input.repoFullName);
  if (!ref || ref.number !== undefined) throw new ValidationError('gap.repo_invalid', 'That does not look like a GitHub repository.');
  const result = await gapHelpers(actor, { tags: [input.tag] });
  const eligible = result.state === 'open' && (result.helpers[input.tag] ?? []).some((helper) => helper.userId === input.toUserId);
  if (!eligible) throw new ValidationError('gap.not_a_helper', 'That member is not listed for this gap any more.');
  return createRequest(actor.id, { toUserId: input.toUserId, message: input.message, contextKind: 'gap', contextId: `${ref.owner}/${ref.repo}`, icebreakerKey: null }, now);
}
