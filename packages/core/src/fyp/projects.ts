import { bm25Index, bm25Scores, bm25Tokens, markdownToText } from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addFypLegacyEntry,
  confirmFypProject,
  countConfirmedProjects,
  deleteFypProject,
  dismissFypProject,
  getFypProject,
  getProfileDetails,
  getSetting,
  insertDetectedProject,
  insertNotification,
  memberOwnRepos,
  ownFypProjects,
  recordedRepoIds,
  universityCorpus,
  upsertConfirmedProject,
  verifiedMembersWithGithub,
  type OwnFypProject,
} from '@commitmates/db';
import { SERVER_IDENTITY, fetchReadme, githubFor, type GitHubClient } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { weekStart } from '../adoptions/listings';
import { entryTags } from '../legacy/service';
import type { Member } from '../profiles/schemas';
import { getMember } from '../profiles/service';

import { MAX_README_CHARS, PERCENT, detectLanguage, ideaText } from './jobs';
import { fypInputSchema, type FypInput } from './schemas';

/** Time kept in hand before the deadline when reading READMEs. */
const DEADLINE_MARGIN_MS = 4000;

type Actor = Pick<Member, 'id' | 'verified' | 'universityId' | 'githubId' | 'hasValidToken'>;

const clientFor = (member: Pick<Member, 'id' | 'hasValidToken'>) => githubFor(member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY);

/** A repository's name, description and README as plain text, at most the F9 README length (§8 F9 step 3). */
async function corpusTextOf(client: GitHubClient, repo: { fullName: string; description: string | null }, deadline?: number): Promise<{ text: string; readme: string | null }> {
  const [owner = '', name = ''] = repo.fullName.split('/');
  const readme = await fetchReadme(client, owner, name, deadline === undefined ? {} : { deadline });
  const body = readme === null ? '' : markdownToText(readme);
  return { text: `${name}\n${repo.description ?? ''}\n${body}`.slice(0, MAX_README_CHARS), readme };
}

async function requireOwnRepo(actor: Actor, repoGithubId: number) {
  if (!actor.verified || actor.universityId === null || actor.githubId === null) throw new ForbiddenError('fyp.verify_first', 'Verify your university to add past projects.');
  const repo = (await memberOwnRepos(actor.githubId)).find((own) => own.githubId === repoGithubId);
  if (!repo) throw new ValidationError('fyp.not_yours', 'You can only add your own repositories.', { field: 'repoGithubId' });
  return { repo, universityId: actor.universityId };
}

async function checkYear(year: number | null, now: Date): Promise<void> {
  if (year === null) return;
  const [maxAhead, maxBehind] = await Promise.all([getSetting('profile.gradYearMaxAhead'), getSetting('profile.gradYearMaxBehind')]);
  const current = now.getUTCFullYear();
  if (year < current - maxBehind || year > current + maxAhead) throw new ValidationError('fyp.year', `Enter a year between ${current - maxBehind} and ${current + maxAhead}.`, { field: 'year' });
}

/** A confirmed project also appears in Senior's Legacy (§8 F17 "Sources of entries"). */
async function feedLegacy(actor: Pick<Member, 'id'>, universityId: string, repo: { githubId: number; topics: readonly string[] }): Promise<void> {
  const details = await getProfileDetails(actor.id);
  await addFypLegacyEntry({ universityId, ownerUserId: actor.id, repoGithubId: repo.githubId, gradYear: details?.gradYear ?? null, tags: await entryTags(repo.githubId, repo.topics) });
}

const yearField = z
  .union([z.literal(''), z.coerce.number().int()])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

export const submitProjectSchema = z.object({ repoGithubId: z.coerce.number().int().positive(), year: yearField });

/**
 * A senior submits one of their own repositories as their final-year project (§8 F22 "Past projects
 * corpus"): it is confirmed at once, its README becomes part of the university's corpus, and it
 * joins Senior's Legacy.
 */
export async function submitPastProject(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const input = submitProjectSchema.parse(raw);
  const { repo, universityId } = await requireOwnRepo(actor, input.repoGithubId);
  await checkYear(input.year, now);
  const { text } = await corpusTextOf(clientFor(actor), repo);
  const id = await upsertConfirmedProject({ universityId, repoGithubId: repo.githubId, ownerUserId: actor.id, year: input.year, submittedBy: actor.id, corpusText: text });
  await feedLegacy(actor, universityId, repo);
  return id;
}

export const projectActionSchema = z.object({ projectId: z.uuid(), year: yearField });

async function ownProject(actor: Pick<Member, 'id'>, projectId: string) {
  const project = await getFypProject(projectId);
  if (project?.ownerUserId !== actor.id) throw new NotFoundError('fyp.not_found', 'That project is not yours or no longer exists.');
  return project;
}

/** The owner confirms a detected project (§8 F22: detection proposals wait for the owner). */
export async function confirmDetectedProject(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const input = projectActionSchema.parse(raw);
  const project = await ownProject(actor, input.projectId);
  await checkYear(input.year, now);
  const { repo } = await requireOwnRepo(actor, project.repoGithubId);
  await confirmFypProject(project.id, input.year);
  await feedLegacy(actor, project.universityId, repo);
}

/** The owner says a detected repository is not a final-year project; it is not proposed again. */
export async function dismissDetectedProject(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<void> {
  const input = projectActionSchema.parse(raw);
  const project = await ownProject(actor, input.projectId);
  if (project.confirmed) throw new ValidationError('fyp.confirmed', 'That project is already confirmed. Remove it instead.');
  await dismissFypProject(project.id, now);
}

/** The owner removes one of their projects from the corpus, with the Senior's Legacy entry it fed. */
export async function removePastProject(actor: Pick<Member, 'id'>, raw: unknown): Promise<void> {
  const input = projectActionSchema.parse(raw);
  await deleteFypProject(await ownProject(actor, input.projectId));
}

/** A member's own confirmed projects and the detections waiting for them. */
export async function getPastProjects(actor: Pick<Member, 'id'>): Promise<OwnFypProject[]> {
  return ownFypProjects(actor.id);
}

/** Whole words of `term` in `text`, case-insensitive (`fyp.detectTerms` are words or phrases). */
const mentions = (text: string, term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

/**
 * Detection for one member (§8 F22 "Past projects corpus"): their own repositories with a README
 * that the university does not already record are read, and those mentioning a `fyp.detectTerms`
 * term are proposed to the owner, unconfirmed. The member's own token is used when valid.
 */
export async function detectMemberProjects(userId: string, deadline: number): Promise<{ detected: number; done: boolean }> {
  const member = await getMember(userId);
  if (!member?.verified || member.universityId === null || member.githubId === null) return { detected: 0, done: true };
  const [terms, recorded, repos] = await Promise.all([getSetting('fyp.detectTerms'), recordedRepoIds(member.universityId), memberOwnRepos(member.githubId)]);
  const client = clientFor(member);
  let detected = 0;
  for (const repo of repos) {
    if (recorded.has(repo.githubId)) continue;
    if (Date.now() > deadline - DEADLINE_MARGIN_MS) return { detected, done: false };
    const { text, readme } = await corpusTextOf(client, repo, deadline);
    if (readme === null || !terms.some((term) => mentions(readme, term))) continue;
    if (await insertDetectedProject({ universityId: member.universityId, repoGithubId: repo.githubId, ownerUserId: member.id, corpusText: text })) detected += 1;
  }
  if (detected > 0) await insertNotification(member.id, 'fyp_detected', { count: detected });
  return { detected, done: true };
}

const detectPayloadSchema = z.union([z.object({ userId: z.uuid() }), z.object({})]);

/** `fyp_detect_projects` (CLAUDE.md §5.4): weekly, one detection per verified member and week. */
export const fypDetectProjectsJob: JobHandler<z.infer<typeof detectPayloadSchema>> = {
  type: 'fyp_detect_projects',
  schema: detectPayloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const now = ctx.now();
    if (!('userId' in payload)) {
      const members = await verifiedMembersWithGithub();
      for (const { userId } of members) {
        await enqueue('fyp_detect_projects', { userId }, { idempotencyKey: `fyp-detect:${userId}:${weekStart(now)}`, priority: PRIORITY.MAINTENANCE });
      }
      return { kind: 'done', resultRef: { queued: members.length } };
    }
    const outcome = await detectMemberProjects(payload.userId, ctx.deadline);
    return outcome.done ? { kind: 'done', resultRef: outcome } : { kind: 'continue', payload };
  },
};

export type UniversityMatch = { projectId: string; fullName: string | null; description: string | null; year: number | null; similarity: number; band: 'very-similar' | 'related' | 'loose' };

/**
 * How close an idea is to the university's own past projects (§8 F9 step 6): BM25 over the corpus
 * texts, against the idea's own score as 100 %, the `fyp.searchTopN` closest; null until the
 * university records `fyp.minCorpus` confirmed projects.
 */
export async function universityMatches(universityId: string, input: FypInput): Promise<UniversityMatch[] | null> {
  const [minCorpus, count] = await Promise.all([getSetting('fyp.minCorpus'), countConfirmedProjects(universityId)]);
  if (count < minCorpus) return null;
  const [topN, bands, k1, b, corpus] = await Promise.all([getSetting('fyp.searchTopN'), getSetting('fyp.bands'), getSetting('ir.bm25.k1'), getSetting('ir.bm25.b'), universityCorpus(universityId)]);
  const text = ideaText(input);
  const { stopwords } = await detectLanguage(text);
  const query = bm25Tokens(text, stopwords);
  const index = bm25Index([...corpus.map((project) => bm25Tokens(project.corpusText, stopwords)), query]);
  const scores = bm25Scores(index, query, { k1, b });
  const selfScore = scores.at(-1) ?? 0;
  const [relatedAt = 0, veryAt = 0] = bands;
  return corpus
    .map((project, position) => {
      const similarity = Math.round(selfScore === 0 ? 0 : Math.min(PERCENT, (PERCENT * (scores[position] ?? 0)) / selfScore));
      const band = similarity >= veryAt ? ('very-similar' as const) : similarity >= relatedAt ? ('related' as const) : ('loose' as const);
      return { projectId: project.id, fullName: project.fullName, description: project.description, year: project.year, similarity, band };
    })
    .sort((x, y) => y.similarity - x.similarity || (x.fullName ?? '').localeCompare(y.fullName ?? ''))
    .slice(0, topN);
}

/** The "At your university" list of the FYP Idea Checker for a verified member (§8 F9 step 6). */
export async function checkIdeaAtUniversity(actor: Pick<Member, 'verified' | 'universityId'>, raw: unknown): Promise<UniversityMatch[] | null> {
  if (!actor.verified || actor.universityId === null) return null;
  return universityMatches(actor.universityId, fypInputSchema.parse(raw));
}
