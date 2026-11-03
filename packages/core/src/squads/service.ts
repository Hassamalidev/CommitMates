import { randomBytes } from 'node:crypto';

import {
  addDays,
  availabilitySlots,
  centroidTags,
  chooseClusters,
  densify,
  formSquads,
  isValidTimeZone,
  localDate,
  seedFrom,
  startOfLocalDay,
  type SquadCandidate,
} from '@commitmates/algorithms';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addConnection,
  createThread,
  deleteParticipant,
  eventParticipantsOf,
  finalizeSquadVersion,
  getDb,
  getEvent,
  getLogin,
  getParticipant,
  getSetting,
  getSquad,
  getUniversity,
  groupSize,
  insertEvent,
  insertMessage,
  insertNotification,
  insertSquadVersion,
  insertSwapRequest,
  latestSquadVersion,
  latestSquads,
  lockEvent,
  lockSwapRequest,
  moveSquadMember,
  setEventStatus,
  setLockedGroup,
  setSwapRequestStatus,
  swapRequestsFor,
  topicDisplayNames,
  upsertParticipant,
  visibleEvents,
  type EventListItem,
  type EventRow,
  type SquadView,
} from '@commitmates/db';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

/** Tags that name a role: the top two of its centroid (§8 F21 "Roles" step 3). */
const ROLE_TAGS = 2;
/** Days in a week: one availability block per weekday at most. */
const DAYS_PER_WEEK = 7; // allowed-literal: unit conversion
/** Hours in a day, the end of the last availability block. */
const HOURS_PER_DAY = 24; // allowed-literal: unit conversion
/** The smallest team: two people. */
const MIN_TEAM_SIZE = 2;
/** Bytes of randomness in a group code (8 hex characters). */
const GROUP_CODE_BYTES = 4;

type Actor = Pick<Member, 'id' | 'verified' | 'universityId' | 'timezone'>;

/** Where a member sits for event visibility: their university and its country. */
async function viewerOf(actor: Actor): Promise<{ userId: string; universityId: string; countryCode: string }> {
  if (!actor.verified || actor.universityId === null) throw new ForbiddenError('squads.verify_first', 'Verify your university to take part in events.');
  const university = await getUniversity(actor.universityId);
  if (!university) throw new ForbiddenError('squads.verify_first', 'Verify your university to take part in events.');
  return { userId: actor.id, universityId: university.id, countryCode: university.countryCode };
}

const canSee = (event: EventRow, viewer: { userId: string; universityId: string; countryCode: string }) =>
  event.creatorUserId === viewer.userId ||
  event.visibility === 'public' ||
  (event.visibility === 'university' && event.universityId === viewer.universityId) ||
  (event.visibility === 'country' && event.countryCode === viewer.countryCode);

async function visibleEvent(actor: Actor, eventId: string): Promise<{ event: EventRow; viewer: Awaited<ReturnType<typeof viewerOf>> }> {
  const viewer = await viewerOf(actor);
  const event = await getEvent(eventId);
  if (!event || !canSee(event, viewer)) throw new NotFoundError('squads.not_found', 'That event does not exist or is not open to you.');
  return { event, viewer };
}

const requireOrganizer = (event: EventRow, actor: Pick<Member, 'id'>) => {
  if (event.creatorUserId !== actor.id) throw new ForbiddenError('squads.not_organizer', 'Only the organizer can do that.');
};

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

export const createEventSchema = z.object({
  title: z.string().trim(),
  description: z.string().trim().default(''),
  visibility: z.enum(['university', 'country', 'public']), // allowed-literal: schema enum values (§7.9 events.visibility)
  startsOn: dayString,
  endsOn: dayString,
  teamSize: z.coerce.number().int().optional(),
});

/**
 * Creates an event (§8 F21): open to the organizer's university, their country or everyone; from the
 * start of `startsOn` to the end of `endsOn` in the organizer's timezone; teams of `teamSize`
 * (default `squads.defaultTeamSize`, at least 2, at most `squads.maxTeamSize`).
 */
export async function createEvent(actor: Actor, raw: unknown, now: Date = new Date()): Promise<string> {
  const viewer = await viewerOf(actor);
  const input = createEventSchema.parse(raw);
  const [titleMax, descriptionMax, defaultSize, maxSize] = await Promise.all([
    getSetting('squads.titleMaxChars'),
    getSetting('squads.descriptionMaxChars'),
    getSetting('squads.defaultTeamSize'),
    getSetting('squads.maxTeamSize'),
  ]);
  if (input.title.length === 0 || input.title.length > titleMax) throw new ValidationError('squads.title', `Give the event a title of at most ${titleMax} characters.`, { field: 'title' });
  if (input.description.length > descriptionMax) throw new ValidationError('squads.description', `Keep the description under ${descriptionMax} characters.`, { field: 'description' });
  const teamSize = input.teamSize ?? defaultSize;
  if (teamSize < MIN_TEAM_SIZE || teamSize > maxSize) throw new ValidationError('squads.team_size', `Teams can have ${MIN_TEAM_SIZE} to ${maxSize} people.`, { field: 'teamSize' });
  const timeZone = isValidTimeZone(actor.timezone) ? actor.timezone : 'UTC';
  const today = localDate(now, timeZone);
  if (input.startsOn < today) throw new ValidationError('squads.starts', 'Pick a start date from today on.', { field: 'startsOn' });
  if (input.endsOn < input.startsOn) throw new ValidationError('squads.ends', 'The event cannot end before it starts.', { field: 'endsOn' });
  return insertEvent({
    creatorUserId: actor.id,
    title: input.title,
    description: input.description === '' ? null : input.description,
    visibility: input.visibility,
    universityId: input.visibility === 'university' ? viewer.universityId : null,
    countryCode: input.visibility === 'country' ? viewer.countryCode : null,
    startsAt: startOfLocalDay(input.startsOn, timeZone),
    endsAt: startOfLocalDay(addDays(input.endsOn, 1), timeZone),
    teamSize,
  });
}

/** Events the member can join or organizes, soonest first (§8 F21 "Routes"). */
export async function listEvents(actor: Actor, now: Date = new Date()): Promise<EventListItem[]> {
  const viewer = await viewerOf(actor);
  return visibleEvents(viewer, now, await getSetting('squads.listLimit'));
}

const blockSchema = z
  .object({ weekday: z.number().int().min(0).max(DAYS_PER_WEEK - 1), from: z.number().int().min(0).max(HOURS_PER_DAY - 1), to: z.number().int().min(1).max(HOURS_PER_DAY) })
  .refine((block) => block.from < block.to, { message: 'Each free time must end after it starts.' });

export const availabilitySchema = z
  .array(blockSchema)
  .max(DAYS_PER_WEEK)
  .refine((blocks) => new Set(blocks.map((block) => block.weekday)).size === blocks.length, { message: 'Give one free time per day.' });

/** What a participant stores: their free time per weekday, in their own timezone. */
const storedAvailabilitySchema = z.object({ timeZone: z.string(), blocks: availabilitySchema });
export type Availability = z.infer<typeof storedAvailabilitySchema>;

const parseAvailability = (value: unknown): Availability | null => {
  const parsed = storedAvailabilitySchema.safeParse(value);
  return parsed.success && parsed.data.blocks.length > 0 ? parsed.data : null;
};

export const joinEventSchema = z.object({ eventId: z.uuid(), availability: availabilitySchema.default([]) });

/** Joins an open event, or updates the member's free time in it (§8 F21 "Routes": join, availability). */
export async function joinEvent(actor: Actor, raw: unknown): Promise<void> {
  const input = joinEventSchema.parse(raw);
  const { event } = await visibleEvent(actor, input.eventId);
  if (event.status !== 'open') throw new ValidationError('squads.closed', 'This event is no longer taking participants.');
  const timeZone = isValidTimeZone(actor.timezone) ? actor.timezone : 'UTC';
  await upsertParticipant(event.id, actor.id, input.availability.length > 0 ? { timeZone, blocks: input.availability } : null);
}

export const eventActionSchema = z.object({ eventId: z.uuid() });

/** Leaves an event before teams are formed. */
export async function leaveEvent(actor: Actor, raw: unknown): Promise<void> {
  const { eventId } = eventActionSchema.parse(raw);
  const { event } = await visibleEvent(actor, eventId);
  if (event.status !== 'open') throw new ValidationError('squads.closed', 'Teams are already being formed, so you can no longer leave here. Ask the organizer.');
  await deleteParticipant(event.id, actor.id);
}

async function requireOpenParticipant(actor: Actor, eventId: string) {
  const { event } = await visibleEvent(actor, eventId);
  if (event.status !== 'open') throw new ValidationError('squads.closed', 'Groups can only change before teams are formed.');
  const participant = await getParticipant(event.id, actor.id);
  if (!participant) throw new ValidationError('squads.not_joined', 'Join the event first.');
  return { event, participant };
}

/** Starts a locked group: friends who join it with its code are always placed in one team (§8 F21 step 2). */
export async function createGroup(actor: Actor, raw: unknown): Promise<string> {
  const { eventId } = eventActionSchema.parse(raw);
  const { event } = await requireOpenParticipant(actor, eventId);
  const code = randomBytes(GROUP_CODE_BYTES).toString('hex');
  await setLockedGroup(event.id, actor.id, code);
  return code;
}

export const joinGroupSchema = z.object({ eventId: z.uuid(), code: z.string().trim().toLowerCase() });

/** Joins a friend's locked group by its code; a group never grows past the event's team size. */
export async function joinGroup(actor: Actor, raw: unknown): Promise<void> {
  const input = joinGroupSchema.parse(raw);
  const { event, participant } = await requireOpenParticipant(actor, input.eventId);
  if (participant.lockedGroupKey === input.code) return;
  const size = input.code === '' ? 0 : await groupSize(event.id, input.code);
  if (size === 0) throw new ValidationError('squads.no_group', 'No group in this event has that code.', { field: 'code' });
  if (size >= event.teamSize) throw new ValidationError('squads.group_full', 'That group already fills a whole team.', { field: 'code' });
  await setLockedGroup(event.id, actor.id, input.code);
}

/** Leaves the member's locked group. */
export async function leaveGroup(actor: Actor, raw: unknown): Promise<void> {
  const { eventId } = eventActionSchema.parse(raw);
  const { event } = await requireOpenParticipant(actor, eventId);
  await setLockedGroup(event.id, actor.id, null);
}

/**
 * The organizer asks for teams (§8 F21 "Formation"): once the event has `unlock.squads.minParticipants`
 * participants, `form_squads` builds the next version; while teams are only proposed, asking again
 * builds a new version from the current participants.
 */
export async function requestFormation(actor: Actor, raw: unknown): Promise<number> {
  const { eventId } = eventActionSchema.parse(raw);
  const { event } = await visibleEvent(actor, eventId);
  requireOrganizer(event, actor);
  if (event.status !== 'open' && event.status !== 'forming') throw new ValidationError('squads.final', 'Teams are already final.');
  const [participants, required] = await Promise.all([eventParticipantsOf(event.id), getSetting('unlock.squads.minParticipants')]);
  if (participants.length < required) throw new ValidationError('squads.locked', `Teams can be formed once ${required} people have joined (${participants.length} so far).`);
  const version = (await latestSquadVersion(event.id)) + 1;
  await setEventStatus(event.id, 'forming');
  await enqueue('form_squads', { eventId: event.id, version }, { idempotencyKey: `squads:${event.id}:${version}`, priority: PRIORITY.USER_BG });
  return version;
}

/**
 * Builds one version of an event's teams (§8 F21 "Roles", "Formation"): roles from k-means over the
 * participants' skill vectors (k by silhouette, seeded by event and version), named by their top
 * tags; then coverage-first greedy teams around locked groups and free time.
 */
export async function buildSquads(eventId: string, version: number): Promise<{ teams: number; roles: string[] } | null> {
  const event = await getEvent(eventId);
  if (event?.status !== 'forming' || (await latestSquadVersion(eventId)) >= version) return null;
  const [participants, kMax, maxIterations, minOverlapHours] = await Promise.all([
    eventParticipantsOf(eventId),
    getSetting('squads.kMax'),
    getSetting('squads.maxIterations'),
    getSetting('squads.minOverlapHours'),
  ]);
  const withSkills = participants.filter((participant) => participant.vector && Object.values(participant.vector).some((weight) => weight > 0));
  const { tags, points } = densify(withSkills.map((participant) => participant.vector ?? {}));
  const clustering = chooseClusters(points, kMax, seedFrom(`${eventId}:${version}`), maxIterations);
  const roleTags = clustering.centroids.map((centroid) => centroidTags(centroid, tags, ROLE_TAGS));
  const names = await topicDisplayNames([...new Set(roleTags.flat())]);
  const roles = roleTags.map((list) => list.map((tag) => names.get(tag) ?? tag).join(' · '));
  const roleOf = new Map(withSkills.map((participant, index) => [participant.userId, clustering.assignments[index] ?? null]));

  const candidates: SquadCandidate[] = participants.map((participant) => {
    const availability = parseAvailability(participant.availability);
    return {
      id: participant.userId,
      role: roleOf.get(participant.userId) ?? null,
      activity: participant.activity,
      slots: availability ? availabilitySlots(availability.blocks, availability.timeZone, event.startsAt) : null,
      group: participant.lockedGroupKey,
    };
  });
  const teams = formSquads(candidates, { teamSize: event.teamSize, roleCount: roles.length, minOverlapHours });
  const labelOf = (userId: string) => {
    const role = roleOf.get(userId);
    const label = role === null || role === undefined ? undefined : roles[role];
    return label === undefined || label === '' ? null : label;
  };
  const inserted = await getDb().transaction(async (tx) => {
    const locked = await lockEvent(eventId, tx);
    if (locked?.status !== 'forming' || (await latestSquadVersion(eventId, tx)) >= version) return false;
    await insertSquadVersion(
      eventId,
      version,
      teams.map((team) => team.map((userId) => ({ userId, roleLabel: labelOf(userId) }))),
      tx,
    );
    for (const participant of participants) await insertNotification(participant.userId, 'squads_proposed', { eventId, title: event.title }, tx);
    return true;
  });
  return inserted ? { teams: teams.length, roles } : null;
}

const formPayloadSchema = z.object({ eventId: z.uuid(), version: z.number().int().positive() });

/** `form_squads` (CLAUDE.md §5.4): on the organizer's request. */
export const formSquadsJob: JobHandler<z.infer<typeof formPayloadSchema>> = {
  type: 'form_squads',
  schema: formPayloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload) {
    return { kind: 'done', resultRef: await buildSquads(payload.eventId, payload.version) };
  },
};

export const swapRequestSchema = z.object({ squadId: z.uuid() });

/** A participant asks once per version to move to another proposed team (§8 F21 "Review"). */
export async function requestSquadSwap(actor: Actor, raw: unknown): Promise<string> {
  const { squadId } = swapRequestSchema.parse(raw);
  const squad = await getSquad(squadId);
  if (!squad) throw new NotFoundError('squads.no_team', 'That team does not exist.');
  const { event } = await visibleEvent(actor, squad.eventId);
  const current = await latestSquads(event.id);
  if (squad.status !== 'proposed' || current[0]?.version !== squad.version) throw new ValidationError('squads.stale', 'These teams have changed. Reload to see the latest.');
  const mine = current.find((team) => team.members.some((member) => member.userId === actor.id));
  if (!mine) throw new ValidationError('squads.not_in_team', 'You are not in a team for this event.');
  if (mine.id === squadId) throw new ValidationError('squads.same_team', 'You are already in that team.');
  const requests = await swapRequestsFor(event.id, squad.version);
  if (requests.some((request) => request.fromUser === actor.id)) throw new ValidationError('squads.one_swap', 'You can ask to switch teams once per proposal.');
  const id = await insertSwapRequest(event.id, actor.id, squadId);
  await insertNotification(event.creatorUserId, 'squad_swap_requested', { eventId: event.id, title: event.title, login: await getLogin(actor.id) });
  return id;
}

export const decideSwapSchema = z.object({ requestId: z.uuid(), accept: z.boolean() });

/** The organizer applies or refuses a swap request; an applied one moves the member with their role. */
export async function decideSquadSwap(actor: Actor, raw: unknown): Promise<void> {
  const input = decideSwapSchema.parse(raw);
  const outcome = await getDb().transaction(async (tx) => {
    const request = await lockSwapRequest(input.requestId, tx);
    if (!request) throw new NotFoundError('squads.no_request', 'That request does not exist.');
    const event = await lockEvent(request.eventId, tx);
    if (!event) throw new NotFoundError('squads.no_request', 'That request does not exist.');
    requireOrganizer(event, actor);
    if (request.status !== 'pending') throw new ValidationError('squads.decided', 'That request was already decided.');
    const squad = await getSquad(request.toSquadId, tx);
    const version = await latestSquadVersion(event.id, tx);
    if (squad?.status !== 'proposed' || squad.version !== version) {
      await setSwapRequestStatus(request.id, 'rejected', tx);
      return { request, event, accepted: false };
    }
    if (input.accept) await moveSquadMember(event.id, version, request.fromUser, request.toSquadId, tx);
    await setSwapRequestStatus(request.id, input.accept ? 'done' : 'rejected', tx);
    return { request, event, accepted: input.accept };
  });
  await insertNotification(outcome.request.fromUser, 'squad_swap_decided', { eventId: outcome.event.id, title: outcome.event.title, accepted: outcome.accepted });
}

/** Prefix of the system message that opens a final team's conversation. */
export const SQUAD_NOTE_PREFIX = 'squad:';

/** The note opening a team's conversation: the event and who brings which role, as data the chat words. */
export function squadNote(title: string, members: readonly { login: string | null; roleLabel: string | null }[]): string {
  return SQUAD_NOTE_PREFIX + JSON.stringify({ event: title, members: members.map((member) => ({ login: member.login, role: member.roleLabel })) });
}

/**
 * The organizer finalizes the latest proposal (§8 F21 "Review"): each team gets a `squad` group
 * conversation opened by a note of who brings what, members are connected, waiting swap requests
 * are refused, and everyone is told.
 */
export async function finalizeSquads(actor: Actor, raw: unknown): Promise<void> {
  const { eventId } = eventActionSchema.parse(raw);
  const finalized = await getDb().transaction(async (tx) => {
    const event = await lockEvent(eventId, tx);
    if (!event) throw new NotFoundError('squads.not_found', 'That event does not exist or is not open to you.');
    requireOrganizer(event, actor);
    if (event.status !== 'forming') throw new ValidationError('squads.not_forming', 'Form teams before finalizing them.');
    const teams = (await latestSquads(eventId, tx)).filter((team) => team.members.length > 0);
    if (teams.length === 0 || teams[0]?.status !== 'proposed') throw new ValidationError('squads.not_ready', 'The teams are still being formed. Try again in a moment.');
    const threads = new Map<string, string>();
    for (const team of teams) {
      const ids = team.members.map((member) => member.userId);
      const threadId = await createThread('squad', ids, event.title, tx);
      await insertMessage({ threadId, authorUserId: null, kind: 'system', body: squadNote(event.title, team.members) }, tx);
      for (const [index, a] of ids.entries()) for (const b of ids.slice(index + 1)) await addConnection(a, b, 'squad', tx);
      threads.set(team.id, threadId);
    }
    await finalizeSquadVersion(eventId, threads, tx);
    await setEventStatus(eventId, 'finalized', tx);
    return { event, teams, threads };
  });
  for (const team of finalized.teams) {
    for (const member of team.members) {
      await insertNotification(member.userId, 'squads_final', { eventId, title: finalized.event.title, threadId: finalized.threads.get(team.id) ?? null });
    }
  }
}

export type EventView = {
  event: EventRow;
  organizerLogin: string | null;
  isOrganizer: boolean;
  participants: number;
  /** Logins of participants, for the organizer only. */
  participantLogins: (string | null)[] | null;
  unlock: { current: number; required: number; unlocked: boolean };
  me: { joined: boolean; availability: Availability['blocks']; groupCode: string | null; groupSize: number };
  squads: SquadView[];
  mySquadId: string | null;
  myRequest: { toSquadId: string; status: string } | null;
  /** Swap requests waiting for the organizer. */
  pendingSwaps: { id: string; login: string | null; toSquadId: string }[];
  rules: { minOverlapHours: number; maxTeamSize: number };
};

/** One event as a member sees it (§8 F21 "Routes": `/events/[id]`). */
export async function getEventView(actor: Actor, eventId: string): Promise<EventView> {
  const { event } = await visibleEvent(actor, eventId);
  const isOrganizer = event.creatorUserId === actor.id;
  const [participants, required, minOverlapHours, maxTeamSize, organizerLogin, squads] = await Promise.all([
    eventParticipantsOf(event.id),
    getSetting('unlock.squads.minParticipants'),
    getSetting('squads.minOverlapHours'),
    getSetting('squads.maxTeamSize'),
    getLogin(event.creatorUserId),
    latestSquads(event.id),
  ]);
  const mine = participants.find((participant) => participant.userId === actor.id);
  const requests = squads[0] ? await swapRequestsFor(event.id, squads[0].version) : [];
  const own = requests.find((request) => request.fromUser === actor.id);
  return {
    event,
    organizerLogin,
    isOrganizer,
    participants: participants.length,
    participantLogins: isOrganizer ? participants.map((participant) => participant.login) : null,
    unlock: { current: participants.length, required, unlocked: participants.length >= required },
    me: {
      joined: mine !== undefined,
      availability: parseAvailability(mine?.availability)?.blocks ?? [],
      groupCode: mine?.lockedGroupKey ?? null,
      groupSize: mine?.lockedGroupKey ? participants.filter((participant) => participant.lockedGroupKey === mine.lockedGroupKey).length : 0,
    },
    squads,
    mySquadId: squads.find((team) => team.members.some((member) => member.userId === actor.id))?.id ?? null,
    myRequest: own ? { toSquadId: own.toSquadId, status: own.status } : null,
    pendingSwaps: isOrganizer ? requests.filter((request) => request.status === 'pending').map((request) => ({ id: request.id, login: request.login, toSquadId: request.toSquadId })) : [],
    rules: { minOverlapHours, maxTeamSize },
  };
}
