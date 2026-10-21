import { markdownExcerpt } from '@commitmates/algorithms';
import {
  NotFoundError,
  ValidationError,
  deleteLegacyEntry,
  deleteLegacyEntryById,
  getLegacyEntry,
  getPackageTags,
  getProfileDetails,
  getRepoDependencies,
  getSetting,
  isBlockedEitherWay,
  legacyEntriesForRefresh,
  listDepartments,
  memberLegacyEntries,
  memberOwnRepos,
  refreshRepoMetadata,
  searchLegacyEntries,
  setLegacyTags,
  upsertLegacyEntry,
  type Department,
  type LegacyEntryView,
} from '@commitmates/db';
import { GitHubNotFoundError, SERVER_IDENTITY, fetchReadme, fetchRepositoryById, githubFor } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import { createRequest } from '../chat/service';
import type { Member } from '../profiles/schemas';
import { getCachedExpansion } from '../taxonomy/service';
import { requestExpansion } from '../taxonomy/jobs';
import { campusUnlocks } from '../universities/campus';

/** Time kept in hand before the deadline; the rest of the refresh continues in a follow-up. */
const DEADLINE_MARGIN_MS = 4000;
/** Longest search text or tag accepted from the page. Bounds the input only. */
const MAX_QUERY_CHARS = 100;

type Actor = Pick<Member, 'id' | 'verified' | 'universityId' | 'githubId'>;

/** An entry's tags (§8 F17 "Indexing"): the repository's topics and its dependencies' derived tags. */
async function entryTags(repoGithubId: number, topics: readonly string[]): Promise<string[]> {
  const dependencies = await getRepoDependencies([repoGithubId]);
  const derived = await getPackageTags(dependencies.map((dependency) => ({ ecosystem: dependency.ecosystem, name: dependency.packageName })));
  return [...new Set([...topics, ...[...derived.values()].flat()].flatMap((tag) => normalizeTag(tag) ?? []))].sort();
}

/**
 * Whether an author is a senior or an alumnus (§8 F17 "Sources of entries"): alumni by role; seniors
 * when their graduation year is at most this year plus `legacy.minGradYearsAgo`. Others are labelled by year.
 */
export function standingOf(entry: Pick<LegacyEntryView, 'ownerRole' | 'gradYear'>, year: number, minGradYearsAgo: number): 'alumni' | 'senior' | null {
  if (entry.ownerRole === 'alumni') return 'alumni';
  return entry.gradYear !== null && entry.gradYear <= year + minGradYearsAgo ? 'senior' : null;
}

export const addEntrySchema = z.object({
  repoGithubId: z.coerce.number().int().positive(),
  blurb: z.string().trim(),
  acceptsQuestions: z.boolean(),
});

/** Showcases one of the member's own public repositories at their university (§8 F17 "Showcase"). */
export async function addLegacyEntry(actor: Actor, raw: unknown): Promise<string> {
  if (!actor.verified || actor.universityId === null || actor.githubId === null) throw new ValidationError('legacy.verify_first', 'Verify your university to showcase projects.');
  const input = addEntrySchema.parse(raw);
  const maxBlurb = await getSetting('legacy.blurbMaxChars');
  if (input.blurb.length > maxBlurb) throw new ValidationError('legacy.blurb_long', `Keep the blurb under ${maxBlurb} characters.`, { field: 'blurb' });
  const repo = (await memberOwnRepos(actor.githubId)).find((own) => own.githubId === input.repoGithubId);
  if (!repo) throw new ValidationError('legacy.not_yours', 'You can only showcase your own repositories.', { field: 'repoGithubId' });
  const details = await getProfileDetails(actor.id);
  return upsertLegacyEntry({
    universityId: actor.universityId,
    ownerUserId: actor.id,
    repoGithubId: repo.githubId,
    gradYear: details?.gradYear ?? null,
    tags: await entryTags(repo.githubId, repo.topics),
    blurb: input.blurb === '' ? null : input.blurb,
    acceptsQuestions: input.acceptsQuestions,
  });
}

export const entryIdSchema = z.object({ entryId: z.uuid() });

export async function removeLegacyEntry(actor: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  const { entryId } = entryIdSchema.parse(raw);
  if (!(await deleteLegacyEntry(actor.id, entryId))) throw new NotFoundError('legacy.not_found', 'That entry is not yours or no longer exists.');
}

/** A member's showcase entries and the repositories they could add. */
export async function getShowcase(actor: Actor) {
  if (!actor.verified || actor.githubId === null) return { entries: [], repos: [], blurbMaxChars: await getSetting('legacy.blurbMaxChars') };
  const [entries, repos, blurbMaxChars] = await Promise.all([memberLegacyEntries(actor.id), memberOwnRepos(actor.githubId), getSetting('legacy.blurbMaxChars')]);
  const shown = new Set(entries.map((entry) => entry.repoGithubId));
  return { entries, repos: repos.filter((repo) => !shown.has(repo.githubId)), blurbMaxChars };
}

const refreshPayloadSchema = z.object({ after: z.uuid().optional() });

/**
 * `legacy_refresh` (§8 F17 "Indexing", weekly): each entry's repository metadata is read again and
 * its tags recomputed. A repository that is gone, private, or no longer the owner's leaves the library.
 */
export const legacyRefreshJob: JobHandler<z.infer<typeof refreshPayloadSchema>> = {
  type: 'legacy_refresh',
  schema: refreshPayloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const entries = (await legacyEntriesForRefresh()).filter((entry) => payload.after === undefined || entry.id > payload.after);
    let refreshed = 0;
    for (const entry of entries) {
      if (Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) return { kind: 'continue', payload: { after: entry.id } };
      try {
        const repo = await fetchRepositoryById(client, entry.repoGithubId, { deadline: ctx.deadline });
        if (repo.isPrivate || repo.ownerGithubId !== entry.ownerGithubId) {
          await deleteLegacyEntryById(entry.id);
          continue;
        }
        await refreshRepoMetadata(
          {
            githubId: repo.githubId,
            fullName: repo.fullName,
            description: repo.description,
            topics: repo.topics,
            primaryLanguage: repo.language,
            stars: repo.stars,
            forks: repo.forks,
            pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
          },
          ctx.now(),
        );
        await setLegacyTags(entry.id, await entryTags(repo.githubId, repo.topics));
        refreshed += 1;
      } catch (error) {
        if (!(error instanceof GitHubNotFoundError)) throw error;
        await deleteLegacyEntryById(entry.id);
      }
    }
    return { kind: 'done', resultRef: { refreshed } };
  },
};

export const legacyQuerySchema = z.object({
  q: z.string().trim().max(MAX_QUERY_CHARS).optional(),
  tag: z.string().trim().max(MAX_QUERY_CHARS).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  department: z.uuid().optional(),
  sort: z.enum(['relevance', 'stars']).default('relevance'),
});

export type LegacyView =
  | { state: 'unverified' }
  | { state: 'locked'; current: number; required: number }
  | {
      state: 'open';
      entries: (LegacyEntryView & { standing: 'alumni' | 'senior' | null })[];
      departments: Department[];
      expanded: string[];
    };

/**
 * Senior's Legacy for a member (§8 F17 "Search"): entries at their university, searched with the
 * query's taxonomy expansion when one is cached (otherwise it is queued and the plain text is used),
 * filtered by tag, graduation years and department, by relevance or stars. Opens at
 * `unlock.legacy.minProjects` entries.
 */
export async function getLegacy(actor: Actor, raw: unknown, now: Date = new Date()): Promise<LegacyView> {
  if (!actor.verified || actor.universityId === null) return { state: 'unverified' };
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'legacy');
  if (!unlock?.unlocked) return { state: 'locked', current: unlock?.current ?? 0, required: unlock?.required ?? 0 };
  const input = legacyQuerySchema.parse(raw);
  const query = input.q && input.q.length > 0 ? input.q : null;
  let expanded: string[] = [];
  if (query !== null) {
    const expansion = await getCachedExpansion(query, now);
    if (expansion) expanded = expansion.items.filter((item) => item.kind === 'topic').map((item) => item.value);
    else await requestExpansion(query, now);
  }
  const [limit, minGradYearsAgo, departments] = await Promise.all([getSetting('legacy.listLimit'), getSetting('legacy.minGradYearsAgo'), listDepartments(actor.universityId)]);
  const entries = await searchLegacyEntries(actor.universityId, actor.id, {
    query,
    topics: expanded,
    tag: input.tag ? normalizeTag(input.tag) : null,
    gradFrom: input.from ?? null,
    gradTo: input.to ?? null,
    departmentId: input.department ?? null,
    sort: input.sort,
    limit,
  });
  const year = now.getUTCFullYear();
  return { state: 'open', entries: entries.map((entry) => ({ ...entry, standing: standingOf(entry, year, minGradYearsAgo) })), departments, expanded };
}

export type LegacyDetail = LegacyEntryView & { standing: 'alumni' | 'senior' | null; excerpt: string | null; canAsk: boolean };

/** One entry with the start of its README as plain text (§8 F17 "UI"), for members of its university. */
export async function getLegacyDetail(actor: Actor, raw: unknown, now: Date = new Date()): Promise<LegacyDetail | null> {
  const { entryId } = entryIdSchema.parse(raw);
  const entry = await getLegacyEntry(entryId);
  if (!entry?.ownerVisible || !actor.verified || entry.universityId !== actor.universityId) return null;
  if (entry.ownerUserId !== actor.id && (await isBlockedEitherWay(actor.id, entry.ownerUserId))) return null;
  const [excerptChars, minGradYearsAgo] = await Promise.all([getSetting('legacy.excerptChars'), getSetting('legacy.minGradYearsAgo')]);
  const [owner = '', repo = ''] = entry.fullName.split('/');
  const readme = await fetchReadme(githubFor(SERVER_IDENTITY), owner, repo).catch((error: unknown) => {
    if (error instanceof GitHubNotFoundError) return null;
    throw error;
  });
  return {
    ...entry,
    standing: standingOf(entry, now.getUTCFullYear(), minGradYearsAgo),
    excerpt: readme === null ? null : markdownExcerpt(readme, excerptChars),
    canAsk: entry.acceptsQuestions && entry.ownerUserId !== actor.id,
  };
}

export const askAuthorSchema = z.object({ entryId: z.uuid(), message: z.string() });

/**
 * "Ask the author" (§8 F17): a message request with `context_kind = 'legacy'` when the author takes
 * questions. Routing questions to alumni who have them off goes through Alumni Quick Asks (F20).
 */
export async function askLegacyAuthor(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const input = askAuthorSchema.parse(raw);
  const detail = await getLegacyEntry(input.entryId);
  if (!detail?.ownerVisible || !actor.verified || detail.universityId !== actor.universityId) throw new NotFoundError('legacy.not_found', 'That project is no longer in the library.');
  if (!detail.acceptsQuestions || detail.ownerUserId === actor.id) throw new ValidationError('legacy.no_questions', 'The author is not taking questions about this project.');
  return createRequest(actor.id, { toUserId: detail.ownerUserId, message: input.message, contextKind: 'legacy', contextId: detail.id, icebreakerKey: null }, now);
}
