import { alumniCutoffYear, rankAlumni } from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addConnection,
  alumniCandidates,
  createThread,
  expireStaleRoutes,
  findDirectThread,
  getDb,
  getLogin,
  getProfileDetails,
  getSetting,
  insertAlumniQuestion,
  insertMessage,
  insertNotification,
  isBlockedEitherWay,
  knownTags,
  lockAlumniQuestion,
  lockQuestionRoute,
  markAlumni,
  markQuestionAnswered,
  popularTags,
  questionsAskedBy,
  questionsAwaitingReroute,
  questionsRoutedTo,
  resolveTags,
  routeAlumniQuestion,
  setGraduation,
  setAlumniQuestionStatus,
  setRouteStatus,
  studentsGraduatedBefore,
  type AskedQuestion,
  type RoutedQuestion,
} from '@commitmates/db';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { normalizeTag } from '@commitmates/sources';
import { z } from 'zod';

import { extractKeyphrases } from '../fyp/jobs';
import type { Member } from '../profiles/schemas';
import { campusUnlocks } from '../universities/campus';

const MS_PER_HOUR = 60 * 60 * 1000; // allowed-literal: unit conversion
const MS_PER_DAY = 24 * MS_PER_HOUR; // allowed-literal: unit conversion

type Actor = Pick<Member, 'id' | 'verified' | 'universityId'>;

/** A verified member at a university where Alumni Quick Asks are open (`unlock.alumni.minAlumni`). */
async function requireAlumniOpen(actor: Actor): Promise<string> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('alumni.verify_first', 'Verify your university to ask its alumni.');
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'alumni');
  if (!unlock?.unlocked) throw new ForbiddenError('alumni.locked', 'Alumni Quick Asks open once enough alumni of your university have joined.');
  return actor.universityId;
}

/**
 * Daily role transition (CLAUDE.md §8 F20 "Roles"): from `alumni.transitionMonth` of a year on,
 * verified students whose graduation year is earlier than that year become alumni and are told,
 * so they can correct their graduation year if it is wrong.
 */
export async function transitionGraduates(now: Date): Promise<{ transitioned: number }> {
  const cutoff = alumniCutoffYear(now, await getSetting('alumni.transitionMonth'));
  const ids = await studentsGraduatedBefore(cutoff);
  await getDb().transaction(async (tx) => {
    await markAlumni(ids, tx);
    for (const id of ids) await insertNotification(id, 'became_alumni', {}, tx);
  });
  return { transitioned: ids.length };
}

const emptyPayload = z.object({});

/** `role_transition` (CLAUDE.md §5.4), daily. */
export const roleTransitionJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'role_transition',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    return { kind: 'done', resultRef: await transitionGraduates(ctx.now()) };
  },
};

/** Candidate tags of a question: each keyphrase and each of its words, spelled as the vocabulary spells tags. */
function tagCandidates(keyphrases: readonly string[]): string[] {
  const candidates = keyphrases.flatMap((phrase) => [phrase, ...phrase.split(/\s+/)]);
  return [...new Set(candidates.flatMap((candidate) => normalizeTag(candidate) ?? []))];
}

/**
 * A question's tags (§8 F20 step 1): the tags the asker picked first, then YAKE keyphrases of the body
 * that name a tag of the vocabulary exactly or through a topic alias, at most `alumni.maxQuestionTags`.
 */
export async function questionTags(body: string, picked: readonly string[]): Promise<string[]> {
  const [maxTags, keyphrases] = await Promise.all([getSetting('alumni.maxQuestionTags'), extractKeyphrases(body)]);
  const resolved = await resolveTags(tagCandidates(keyphrases));
  return [...new Set([...picked, ...resolved.values()])].slice(0, maxTags);
}

export const askQuestionSchema = z.object({
  body: z.string().trim(),
  tags: z.array(z.string()).default([]),
  anonymous: z.boolean().default(false),
});

/**
 * Asks the university's alumni a short question (§8 F20): at most `alumni.questionMaxChars`
 * characters, tagged from the body and the asker's picks (which must be known tags), optionally
 * anonymous. Routing starts right away in `alumni_route`.
 */
export async function askQuestion(actor: Actor, raw: unknown): Promise<string> {
  const universityId = await requireAlumniOpen(actor);
  const input = askQuestionSchema.parse(raw);
  const maxChars = await getSetting('alumni.questionMaxChars');
  if (input.body.length === 0) throw new ValidationError('alumni.empty', 'Write your question first.', { field: 'body' });
  if (input.body.length > maxChars) throw new ValidationError('alumni.too_long', `Keep it short: at most ${maxChars} characters.`, { field: 'body' });
  const picked = [...new Set(input.tags.flatMap((tag) => normalizeTag(tag) ?? []))];
  const known = await knownTags(picked);
  const unknown = picked.filter((tag) => !known.has(tag));
  if (unknown.length > 0) throw new ValidationError('alumni.unknown_tags', `We don't know these topics yet: ${unknown.join(', ')}.`, { field: 'tags' });
  const tags = await questionTags(input.body, picked);
  const questionId = await insertAlumniQuestion({ askerUserId: actor.id, universityId, body: input.body, tags, anonymous: input.anonymous });
  await enqueueRoute(questionId, 1);
  return questionId;
}

const enqueueRoute = (questionId: string, round: number) =>
  enqueue('alumni_route', { questionId, round }, { idempotencyKey: `alumni:${questionId}:${round}`, priority: PRIORITY.USER_BG });

/**
 * One routing round (§8 F20 "Routing"): the question goes to the top `alumni.routeTopK` verified alumni
 * of its university by route score, never to the asker, someone blocked either way, someone in ghost
 * mode or hidden, or someone it already reached; they are notified. Past `alumni.maxRounds`, or when
 * no alumnus is left to ask, the question expires and the asker is told.
 */
export async function routeQuestion(questionId: string, round: number, now: Date): Promise<{ routed: number; expired: boolean }> {
  const [topK, maxOpen, maxRounds, windowDays] = await Promise.all([
    getSetting('alumni.routeTopK'),
    getSetting('alumni.maxOpenPerAlumnus'),
    getSetting('alumni.maxRounds'),
    getSetting('alumni.responsivenessDays'),
  ]);
  const outcome = await getDb().transaction(async (tx) => {
    const question = await lockAlumniQuestion(questionId, tx);
    if (question?.status !== 'open' || question.round >= round) return null;
    const since = new Date(now.getTime() - windowDays * MS_PER_DAY);
    const candidates = round > maxRounds ? [] : await alumniCandidates(question.universityId, question.askerUserId, questionId, since, tx);
    const chosen = rankAlumni(
      question.tags,
      candidates.map((candidate) => ({ ...candidate, id: candidate.userId })),
      maxOpen,
      topK,
    );
    if (chosen.length === 0) {
      await setAlumniQuestionStatus(questionId, 'expired', tx);
      await insertNotification(question.askerUserId, 'alumni_expired', { questionId }, tx);
      return { routed: 0, expired: true };
    }
    await routeAlumniQuestion(questionId, round, chosen, now, tx);
    for (const alumnus of chosen) await insertNotification(alumnus, 'alumni_question', { questionId }, tx);
    return { routed: chosen.length, expired: false };
  });
  return outcome ?? { routed: 0, expired: false };
}

const routePayloadSchema = z.object({ questionId: z.uuid(), round: z.number().int().positive() });

/** `alumni_route` (CLAUDE.md §5.4): on a new question, and each time a round runs out. */
export const alumniRouteJob: JobHandler<z.infer<typeof routePayloadSchema>> = {
  type: 'alumni_route',
  schema: routePayloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    return { kind: 'done', resultRef: await routeQuestion(payload.questionId, payload.round, ctx.now()) };
  },
};

/**
 * Hourly SLA (§8 F20 step 5): routes unanswered after `alumni.slaHours` expire, and every open question
 * left with no pending route in its round moves to the next round.
 */
export async function enforceAlumniSla(now: Date): Promise<{ expiredRoutes: number; rerouted: number }> {
  const slaHours = await getSetting('alumni.slaHours');
  const touched = await expireStaleRoutes(new Date(now.getTime() - slaHours * MS_PER_HOUR));
  const due = await questionsAwaitingReroute(null);
  for (const question of due) await enqueueRoute(question.id, question.round + 1);
  return { expiredRoutes: touched.length, rerouted: due.length };
}

/** `alumni_sla` (CLAUDE.md §5.4), hourly. */
export const alumniSlaJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'alumni_sla',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    return { kind: 'done', resultRef: await enforceAlumniSla(ctx.now()) };
  },
};

/** Prefix of the system message that opens an answered question's conversation. */
export const QUESTION_NOTE_PREFIX = 'question:';

/** The system message quoting the question (§8 F20 "Answering"), as data the chat view words. */
export function questionNote(body: string): string {
  return QUESTION_NOTE_PREFIX + JSON.stringify({ body });
}

export const questionActionSchema = z.object({ questionId: z.uuid() });

/**
 * An alumnus answers a question routed to them (§8 F20 "Answering"): a direct conversation with the
 * asker opens without a message request (the asker asked first), with a system message quoting the
 * question; an anonymous asker is revealed to this alumnus from here on. The question is answered,
 * other pending routes end, and the asker is told.
 */
export async function answerQuestion(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<string> {
  const { questionId } = questionActionSchema.parse(raw);
  return getDb().transaction(async (tx) => {
    const question = await lockAlumniQuestion(questionId, tx);
    const route = question ? await lockQuestionRoute(questionId, actor.id, tx) : null;
    if (!question || !route) throw new NotFoundError('alumni.not_routed', 'That question was not sent to you.');
    if (question.status !== 'open' || route.status !== 'pending') throw new ValidationError('alumni.closed', 'That question is no longer waiting for an answer.');
    if (await isBlockedEitherWay(actor.id, question.askerUserId, tx)) throw new ValidationError('alumni.closed', 'That question is no longer waiting for an answer.');
    const threadId = (await findDirectThread(actor.id, question.askerUserId, tx)) ?? (await createThread('direct', [question.askerUserId, actor.id], null, tx));
    await insertMessage({ threadId, authorUserId: null, kind: 'system', body: questionNote(question.body) }, tx);
    await setRouteStatus(questionId, actor.id, 'answered', now, tx);
    await markQuestionAnswered(questionId, actor.id, threadId, now, tx);
    await addConnection(actor.id, question.askerUserId, 'alumni', tx);
    await insertNotification(question.askerUserId, 'alumni_answered', { questionId, threadId, login: await getLogin(actor.id, tx) }, tx);
    return threadId;
  });
}

/** An alumnus passes on a question; when nobody in the round is left, the next round starts now. */
export async function passQuestion(actor: Pick<Member, 'id'>, raw: unknown, now: Date = new Date()): Promise<void> {
  const { questionId } = questionActionSchema.parse(raw);
  await getDb().transaction(async (tx) => {
    const route = await lockQuestionRoute(questionId, actor.id, tx);
    if (!route) throw new NotFoundError('alumni.not_routed', 'That question was not sent to you.');
    if (route.status !== 'pending') throw new ValidationError('alumni.closed', 'That question is no longer waiting for an answer.');
    await setRouteStatus(questionId, actor.id, 'passed', now, tx);
  });
  const [due] = await questionsAwaitingReroute([questionId]);
  if (due) await enqueueRoute(due.id, due.round + 1);
}

/** Popular tags offered as quick picks when asking. */
const TAG_SUGGESTIONS = 12;

export type AlumniView =
  | { state: 'locked'; current: number; required: number }
  | {
      state: 'open';
      rules: { maxChars: number; maxTags: number; slaHours: number; maxRounds: number };
      suggestions: string[];
      asked: AskedQuestion[];
      /** Questions routed to the member; null when they are not an alumnus. */
      inbox: RoutedQuestion[] | null;
      /** The member's graduation year, offered for correction to alumni. */
      graduation: { gradYear: number | null; years: { min: number; max: number } } | null;
    };

/** What the Alumni Quick Asks page shows a verified member (§8 F20 "Routes"). */
export async function getAlumni(actor: Actor, now: Date = new Date()): Promise<AlumniView> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('alumni.verify_first', 'Verify your university to ask its alumni.');
  const unlock = (await campusUnlocks(actor.universityId)).unlocks.find((entry) => entry.key === 'alumni');
  if (!unlock?.unlocked) return { state: 'locked', current: unlock?.current ?? 0, required: unlock?.required ?? 0 };
  const [maxChars, maxTags, slaHours, maxRounds, limit, maxAhead, maxBehind, details] = await Promise.all([
    getSetting('alumni.questionMaxChars'),
    getSetting('alumni.maxQuestionTags'),
    getSetting('alumni.slaHours'),
    getSetting('alumni.maxRounds'),
    getSetting('alumni.listLimit'),
    getSetting('profile.gradYearMaxAhead'),
    getSetting('profile.gradYearMaxBehind'),
    getProfileDetails(actor.id),
  ]);
  const isAlumnus = details?.role === 'alumni';
  const [suggestions, asked, inbox] = await Promise.all([
    popularTags(TAG_SUGGESTIONS),
    questionsAskedBy(actor.id, limit),
    isAlumnus ? questionsRoutedTo(actor.id, limit) : Promise.resolve(null),
  ]);
  const year = now.getUTCFullYear();
  return {
    state: 'open',
    rules: { maxChars, maxTags, slaHours, maxRounds },
    suggestions,
    asked,
    inbox,
    graduation: isAlumnus ? { gradYear: details.gradYear, years: { min: year - maxBehind, max: year + maxAhead } } : null,
  };
}

export const graduationSchema = z.object({ gradYear: z.coerce.number().int() });

/**
 * Lets an alumnus correct their graduation year after the role transition (§8 F20 "Roles": "a
 * notification letting them adjust"). A year that has not passed the cutoff makes them a student
 * again, so the next daily transition does not undo the correction.
 */
export async function correctGraduation(actor: Pick<Member, 'id' | 'verified'>, raw: unknown, now: Date = new Date()): Promise<'student' | 'alumni'> {
  if (!actor.verified) throw new ForbiddenError('alumni.verify_first', 'Verify your university first.');
  const { gradYear } = graduationSchema.parse(raw);
  const [details, maxAhead, maxBehind, month] = await Promise.all([
    getProfileDetails(actor.id),
    getSetting('profile.gradYearMaxAhead'),
    getSetting('profile.gradYearMaxBehind'),
    getSetting('alumni.transitionMonth'),
  ]);
  if (details?.role !== 'alumni') throw new ValidationError('alumni.not_alumnus', 'Only alumni can change this here.');
  const year = now.getUTCFullYear();
  if (gradYear < year - maxBehind || gradYear > year + maxAhead) {
    throw new ValidationError('alumni.grad_year', `Enter a year between ${year - maxBehind} and ${year + maxAhead}.`, { field: 'gradYear' });
  }
  const role = gradYear < alumniCutoffYear(now, month) ? 'alumni' : 'student';
  await setGraduation(actor.id, gradYear, role);
  return role;
}
