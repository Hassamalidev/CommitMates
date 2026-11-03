import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  approveSupervisor,
  createThread,
  deleteFypInterest,
  deleteSupervisorApplication,
  getDb,
  getFypIdea,
  getLogin,
  getProfileDetails,
  getSetting,
  getSupervisor,
  ideasAt,
  insertFypIdea,
  insertMessage,
  insertNotification,
  interestIn,
  isBlockedEitherWay,
  knownTags,
  lockFypIdea,
  setFypIdeaStatus,
  supervisorsAt,
  upsertFypInterest,
  upsertSupervisorApplication,
  writeAudit,
  type FypIdeaRow,
  type IdeaListItem,
  type InterestView,
  type SupervisorView,
} from '@commitmates/db';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import { moderationScope } from '../admin/roles';
import type { Member } from '../profiles/schemas';
import { campusUnlocks } from '../universities/campus';

import { extractKeyphrases } from './jobs';
import { universityMatches, type UniversityMatch } from './projects';
import { fypInputSchema } from './schemas';

type Actor = Pick<Member, 'id' | 'verified' | 'universityId'>;

/** A verified member at a university where the FYP Board is open (`unlock.fypBoard.minMembers`). */
async function requireBoardOpen(actor: Actor): Promise<string> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('fyp.verify_first', 'Verify your university to use the FYP Board.');
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'fypBoard');
  if (!unlock?.unlocked) throw new ForbiddenError('fyp.locked', 'The FYP Board opens once enough members of your university have joined.');
  return actor.universityId;
}

/** Whether the FYP Board is open at the member's university, and its progress when it is not. */
export async function fypBoardAccess(actor: Actor): Promise<{ state: 'open' } | { state: 'locked'; current: number; required: number } | { state: 'unverified' }> {
  if (!actor.verified || actor.universityId === null) return { state: 'unverified' };
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'fypBoard');
  return unlock?.unlocked ? { state: 'open' } : { state: 'locked', current: unlock?.current ?? 0, required: unlock?.required ?? 0 };
}

// Supervisors.

export const supervisorApplicationSchema = z.object({ areas: z.array(z.string()) });

/**
 * A member who supervises projects applies with their areas (§8 F22 "Supervisors"): only members
 * whose role is `supervisor_pending` (or approved supervisors updating their areas), with areas from
 * the tag vocabulary, at most `fyp.maxSupervisorAreas`. A moderator of the university or an admin approves.
 */
export async function applySupervisor(actor: Actor, raw: unknown): Promise<void> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('fyp.verify_first', 'Verify your university first.');
  const details = await getProfileDetails(actor.id);
  if (details?.role !== 'supervisor_pending' && details?.role !== 'supervisor') {
    throw new ForbiddenError('fyp.not_supervisor', 'Only members who supervise projects can apply. Choose “I supervise projects” as your role first.');
  }
  const input = supervisorApplicationSchema.parse(raw);
  const areas = [...new Set(input.areas.flatMap((area) => normalizeTag(area) ?? []))];
  const maxAreas = await getSetting('fyp.maxSupervisorAreas');
  if (areas.length === 0) throw new ValidationError('fyp.no_areas', 'Name at least one area you supervise.', { field: 'areas' });
  if (areas.length > maxAreas) throw new ValidationError('fyp.too_many_areas', `List at most ${maxAreas} areas.`, { field: 'areas' });
  const known = await knownTags(areas);
  const unknown = areas.filter((area) => !known.has(area));
  if (unknown.length > 0) throw new ValidationError('fyp.unknown_areas', `We don't know these topics yet: ${unknown.join(', ')}.`, { field: 'areas' });
  await upsertSupervisorApplication(actor.id, actor.universityId, areas);
}

/** The member's own supervisor record at their university, if any. */
export async function ownSupervisorStatus(actor: Actor) {
  if (actor.universityId === null) return null;
  return getSupervisor(actor.id, actor.universityId);
}

/** Whether the member may apply as a supervisor, their application, and the area limit. */
export async function supervisorStanding(actor: Actor): Promise<{ canApply: boolean; application: Awaited<ReturnType<typeof getSupervisor>>; maxAreas: number }> {
  const [details, application, maxAreas] = await Promise.all([getProfileDetails(actor.id), ownSupervisorStatus(actor), getSetting('fyp.maxSupervisorAreas')]);
  return { canApply: actor.verified && (details?.role === 'supervisor_pending' || details?.role === 'supervisor'), application, maxAreas };
}

type Reviewer = Pick<Member, 'id' | 'roles'>;

/** Applications waiting in the reviewer's scope (admins everywhere, moderators their universities). */
export async function pendingSupervisors(reviewer: Reviewer): Promise<SupervisorView[]> {
  const scope = await moderationScope(reviewer);
  return supervisorsAt(scope.admin ? null : scope.universities.map((university) => university.id), false, await getSetting('fyp.listLimit'));
}

export const supervisorDecisionSchema = z.object({ userId: z.uuid(), universityId: z.uuid(), approve: z.boolean() });

/**
 * An admin, or a moderator of that university, approves or turns down an application (§8 F22): an
 * approval makes the member a `supervisor`; a refusal removes the application. Both are audited and
 * the member is told.
 */
export async function decideSupervisor(reviewer: Reviewer, raw: unknown, now: Date = new Date()): Promise<void> {
  const input = supervisorDecisionSchema.parse(raw);
  const scope = await moderationScope(reviewer);
  if (!scope.admin && !scope.universities.some((university) => university.id === input.universityId)) {
    throw new ForbiddenError('fyp.not_your_university', 'You can only review supervisors of universities you moderate.');
  }
  await getDb().transaction(async (tx) => {
    const application = await getSupervisor(input.userId, input.universityId, tx);
    if (application?.approvedAt !== null) throw new NotFoundError('fyp.no_application', 'That application is no longer waiting.');
    if (input.approve) await approveSupervisor(input.userId, input.universityId, reviewer.id, now, tx);
    else await deleteSupervisorApplication(input.userId, input.universityId, tx);
    await writeAudit(
      { actorUserId: reviewer.id, action: input.approve ? 'fyp.supervisor_approved' : 'fyp.supervisor_rejected', targetType: 'user', targetId: input.userId, data: { universityId: input.universityId } },
      tx,
    );
    await insertNotification(input.userId, input.approve ? 'supervisor_approved' : 'supervisor_rejected', {}, tx);
  });
}

/** Approved supervisors at the member's university, with their areas and open ideas (§8 F22 "UI"). */
export async function listSupervisors(actor: Actor): Promise<SupervisorView[]> {
  const universityId = await requireBoardOpen(actor);
  return supervisorsAt([universityId], true, await getSetting('fyp.listLimit'));
}

// Ideas.

export const ideaSchema = fypInputSchema.extend({ supervisorIdea: z.boolean().default(false) });

export type IdeaCheck = { keyphrases: string[]; university: UniversityMatch[] | null };

/**
 * What the author sees before posting (§8 F22 "Ideas"): the idea's keyphrases and its closest past
 * projects at the university; the worldwide check is the FYP Idea Checker's job, run from the page.
 */
export async function checkIdea(actor: Actor, raw: unknown): Promise<IdeaCheck> {
  const universityId = await requireBoardOpen(actor);
  const input = fypInputSchema.parse(raw);
  const [keyphrases, university] = await Promise.all([extractKeyphrases(`${input.title}\n${input.description}`), universityMatches(universityId, input)]);
  return { keyphrases, university };
}

/** Posts an idea with its keyphrases; "supervisor idea" only for approved supervisors of the university. */
export async function postIdea(actor: Actor, raw: unknown): Promise<string> {
  const universityId = await requireBoardOpen(actor);
  const input = ideaSchema.parse(raw);
  if (input.supervisorIdea) {
    const supervisor = await getSupervisor(actor.id, universityId);
    if ((supervisor?.approvedAt ?? null) === null) throw new ForbiddenError('fyp.not_supervisor', 'Only approved supervisors can post supervisor ideas.');
  }
  const keyphrases = await extractKeyphrases(`${input.title}\n${input.description}`);
  return insertFypIdea({ universityId, authorUserId: actor.id, title: input.title, description: input.description, keyphrases, supervisorIdea: input.supervisorIdea });
}

const statusFilter = z.enum(['open', 'team_forming', 'taken', 'archived']); // allowed-literal: schema enum values (§7.9 fyp_ideas.status)

export const ideaFilterSchema = z.object({
  tag: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value)),
  status: z
    .union([statusFilter, z.literal('')])
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value)),
  supervisorOnly: z.boolean().default(false),
});

/** Ideas at the member's university (§8 F22 "UI": filter by tag, status, supervisor ideas). */
export async function listIdeas(actor: Actor, raw: unknown = {}): Promise<IdeaListItem[]> {
  const universityId = await requireBoardOpen(actor);
  const filter = ideaFilterSchema.parse(raw);
  return ideasAt(universityId, actor.id, filter, await getSetting('fyp.listLimit'));
}

export type IdeaDetail = {
  idea: FypIdeaRow;
  authorLogin: string | null;
  isAuthor: boolean;
  /** Who is interested; the author only. */
  interest: InterestView[] | null;
  myInterest: string | null;
  university: UniversityMatch[] | null;
  /** The team's conversation, for its members. */
  threadId: string | null;
};

async function visibleIdea(actor: Actor, ideaId: string): Promise<FypIdeaRow> {
  const universityId = await requireBoardOpen(actor);
  const idea = await getFypIdea(ideaId);
  if (idea?.universityId !== universityId || (await isBlockedEitherWay(actor.id, idea.authorUserId))) throw new NotFoundError('fyp.no_idea', 'That idea does not exist or is not open to you.');
  return idea;
}

/** One idea with its duplicate-check summary against the university's past projects (§8 F22 "UI"). */
export async function getIdea(actor: Actor, ideaId: string): Promise<IdeaDetail> {
  const idea = await visibleIdea(actor, ideaId);
  const isAuthor = idea.authorUserId === actor.id;
  const [authorLogin, interest, university] = await Promise.all([getLogin(idea.authorUserId), interestIn(idea.id), universityMatches(idea.universityId, idea)]);
  const mine = interest.find((entry) => entry.userId === actor.id);
  return {
    idea,
    authorLogin,
    isAuthor,
    interest: isAuthor ? interest : null,
    myInterest: mine?.message ?? null,
    university,
    threadId: isAuthor || mine ? idea.threadId : null,
  };
}

export const interestSchema = z.object({ ideaId: z.uuid(), message: z.string().trim() });

/** A member asks to join an idea's team with a short message (§8 F22 "Ideas"); the author is told. */
export async function expressInterest(actor: Actor, raw: unknown): Promise<void> {
  const input = interestSchema.parse(raw);
  const idea = await visibleIdea(actor, input.ideaId);
  if (idea.authorUserId === actor.id) throw new ValidationError('fyp.own_idea', 'This is your own idea.');
  if (idea.status !== 'open' && idea.status !== 'team_forming') throw new ValidationError('fyp.closed', 'This idea is no longer looking for teammates.');
  const maxChars = await getSetting('fyp.interestMaxChars');
  if (input.message.length === 0) throw new ValidationError('fyp.no_message', 'Say a few words about why you want to join.', { field: 'message' });
  if (input.message.length > maxChars) throw new ValidationError('fyp.message_long', `Keep it under ${maxChars} characters.`, { field: 'message' });
  await upsertFypInterest(idea.id, actor.id, input.message);
  await insertNotification(idea.authorUserId, 'fyp_interest', { ideaId: idea.id, title: idea.title, login: await getLogin(actor.id) });
}

export const ideaActionSchema = z.object({ ideaId: z.uuid() });

export async function withdrawInterest(actor: Actor, raw: unknown): Promise<void> {
  const { ideaId } = ideaActionSchema.parse(raw);
  await deleteFypInterest(ideaId, actor.id);
}

/** Prefix of the system message that opens an idea's team conversation. */
export const FYP_NOTE_PREFIX = 'fyp:';

export const pickTeamSchema = z.object({ ideaId: z.uuid(), userIds: z.array(z.uuid()).min(1) });

/**
 * The author picks teammates among the interested (§8 F22 "Ideas"): a group conversation opens with
 * a note naming the idea, the idea is marked team forming, and the picked members are told.
 */
export async function pickTeam(actor: Actor, raw: unknown): Promise<string> {
  const input = pickTeamSchema.parse(raw);
  await requireBoardOpen(actor);
  const outcome = await getDb().transaction(async (tx) => {
    const idea = await lockFypIdea(input.ideaId, tx);
    if (idea?.authorUserId !== actor.id) throw new NotFoundError('fyp.no_idea', 'That idea is not yours.');
    if (idea.threadId !== null) throw new ValidationError('fyp.team_formed', 'You already picked a team for this idea.');
    if (idea.status !== 'open') throw new ValidationError('fyp.closed', 'This idea is no longer looking for teammates.');
    const interested = new Set((await interestIn(idea.id, tx)).map((entry) => entry.userId));
    const picked = [...new Set(input.userIds)];
    if (picked.some((userId) => !interested.has(userId))) throw new ValidationError('fyp.not_interested', 'Pick only people who asked to join.');
    const threadId = await createThread('group', [actor.id, ...picked], idea.title, tx);
    await insertMessage({ threadId, authorUserId: null, kind: 'system', body: FYP_NOTE_PREFIX + JSON.stringify({ title: idea.title }) }, tx);
    await setFypIdeaStatus(idea.id, 'team_forming', threadId, tx);
    return { idea, threadId, picked };
  });
  for (const userId of outcome.picked) await insertNotification(userId, 'fyp_team', { ideaId: outcome.idea.id, title: outcome.idea.title, threadId: outcome.threadId });
  return outcome.threadId;
}

export const ideaStatusSchema = z.object({ ideaId: z.uuid(), status: z.enum(['open', 'taken', 'archived']) }); // allowed-literal: schema enum values the author may set

/** The author marks an idea taken, archives it, or opens it again. */
export async function setIdeaStatus(actor: Actor, raw: unknown): Promise<void> {
  const input = ideaStatusSchema.parse(raw);
  const idea = await getFypIdea(input.ideaId);
  if (idea?.authorUserId !== actor.id) throw new NotFoundError('fyp.no_idea', 'That idea is not yours.');
  await setFypIdeaStatus(idea.id, input.status === 'open' && idea.threadId !== null ? 'team_forming' : input.status, undefined);
}
