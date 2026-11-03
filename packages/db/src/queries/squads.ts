import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { eventParticipants, events, squadMembers, squadSwapRequests, squads } from '../schema';

export type EventRow = typeof events.$inferSelect;

export async function insertEvent(
  event: Pick<EventRow, 'creatorUserId' | 'title' | 'description' | 'visibility' | 'universityId' | 'countryCode' | 'startsAt' | 'endsAt' | 'teamSize'>,
  db: DbOrTx = getDb(),
): Promise<string> {
  const [row] = await db.insert(events).values(event).returning({ id: events.id });
  if (!row) throw new Error('event insert returned no row');
  return row.id;
}

export async function getEvent(eventId: string, db: DbOrTx = getDb()): Promise<EventRow | null> {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row ?? null;
}

export async function lockEvent(eventId: string, tx: Tx): Promise<EventRow | null> {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  return row ?? null;
}

export async function setEventStatus(eventId: string, status: EventRow['status'], db: DbOrTx = getDb()): Promise<void> {
  await db.update(events).set({ status }).where(eq(events.id, eventId));
}

export type EventListItem = EventRow & { participants: number; joined: boolean };

/**
 * Events a member can see (§8 F21): public ones, their university's, their country's, and their own;
 * not closed and not over, soonest first.
 */
export async function visibleEvents(
  viewer: { userId: string; universityId: string; countryCode: string },
  now: Date,
  limit: number,
  db: DbOrTx = getDb(),
): Promise<EventListItem[]> {
  const rows = await db.execute<{ id: string; participants: string; joined: boolean }>(sql`
    select e.id,
           (select count(*) from event_participants p where p.event_id = e.id) as participants,
           exists (select 1 from event_participants p where p.event_id = e.id and p.user_id = ${viewer.userId}) as joined
    from events e
    where e.status <> 'closed' and e.ends_at > ${now.toISOString()}::timestamptz
      and (e.creator_user_id = ${viewer.userId} or e.visibility = 'public'
           or (e.visibility = 'university' and e.university_id = ${viewer.universityId})
           or (e.visibility = 'country' and e.country_code = ${viewer.countryCode}))
    order by e.starts_at, e.id
    limit ${limit}`);
  if (rows.length === 0) return [];
  const full = await db.select().from(events).where(inArray(events.id, rows.map((row) => row.id)));
  const byId = new Map(full.map((event) => [event.id, event]));
  return rows.flatMap((row) => {
    const event = byId.get(row.id);
    return event ? [{ ...event, participants: Number(row.participants), joined: row.joined }] : [];
  });
}

export type ParticipantRow = {
  userId: string;
  login: string | null;
  availability: unknown;
  lockedGroupKey: string | null;
  vector: Record<string, number> | null;
  activity: number | null;
  timezone: string;
};

/** An event's participants with what formation needs: skill vector, activity score and availability. */
export async function eventParticipantsOf(eventId: string, db: DbOrTx = getDb()): Promise<ParticipantRow[]> {
  const rows = await db.execute<{
    user_id: string;
    login: string | null;
    availability: unknown;
    locked_group_key: string | null;
    vector: Record<string, number> | null;
    activity: number | string | null;
    timezone: string;
  }>(sql`
    select p.user_id, gi.login, p.availability, p.locked_group_key, v.vector,
           (ps.metrics->>'activityScore')::double precision as activity, pr.timezone
    from event_participants p
    join profiles pr on pr.user_id = p.user_id
    left join github_identities gi on gi.user_id = p.user_id
    left join skill_vectors v on v.user_id = p.user_id
    left join persona_snapshots ps on ps.user_id = p.user_id
    where p.event_id = ${eventId}
    order by p.joined_at, p.user_id`);
  return rows.map((row) => ({
    userId: row.user_id,
    login: row.login,
    availability: row.availability,
    lockedGroupKey: row.locked_group_key,
    vector: row.vector,
    activity: row.activity === null ? null : Number(row.activity),
    timezone: row.timezone,
  }));
}

export async function getParticipant(eventId: string, userId: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select()
    .from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)));
  return row ?? null;
}

export async function upsertParticipant(eventId: string, userId: string, availability: unknown, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(eventParticipants)
    .values({ eventId, userId, availability })
    .onConflictDoUpdate({ target: [eventParticipants.eventId, eventParticipants.userId], set: { availability } });
}

export async function deleteParticipant(eventId: string, userId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.delete(eventParticipants).where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)));
}

export async function setLockedGroup(eventId: string, userId: string, key: string | null, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(eventParticipants)
    .set({ lockedGroupKey: key })
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId)));
}

export async function groupSize(eventId: string, key: string, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db.execute<{ count: string }>(
    sql`select count(*) as count from event_participants where event_id = ${eventId} and locked_group_key = ${key}`,
  );
  return Number(row?.count ?? 0);
}

/** Display names of topic slugs, where the topic is known. */
export async function topicDisplayNames(slugs: readonly string[], db: DbOrTx = getDb()): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const list = sql`array[${sql.join(slugs.map((slug) => sql`${slug}`), sql`, `)}]::text[]`;
  const rows = await db.execute<{ slug: string; display_name: string }>(sql`select slug, display_name from topics where slug = any(${list})`);
  return new Map(rows.map((row) => [row.slug, row.display_name]));
}

export type SquadView = { id: string; version: number; status: 'proposed' | 'final'; threadId: string | null; members: { userId: string; login: string | null; roleLabel: string | null }[] };

/** The latest version of an event's squads, with members; empty before the first formation. */
export async function latestSquads(eventId: string, db: DbOrTx = getDb()): Promise<SquadView[]> {
  const rows = await db.execute<{ id: string; version: number; status: 'proposed' | 'final'; thread_id: string | null; user_id: string | null; login: string | null; role_label: string | null }>(sql`
    select s.id, s.version, s.status, s.thread_id, m.user_id, gi.login, m.role_label
    from squads s
    left join squad_members m on m.squad_id = s.id
    left join github_identities gi on gi.user_id = m.user_id
    where s.event_id = ${eventId} and s.version = (select max(version) from squads where event_id = ${eventId})
    order by s.created_at, s.id, gi.login`);
  const byId = new Map<string, SquadView>();
  for (const row of rows) {
    const squad = byId.get(row.id) ?? { id: row.id, version: row.version, status: row.status, threadId: row.thread_id, members: [] };
    if (row.user_id) squad.members.push({ userId: row.user_id, login: row.login, roleLabel: row.role_label });
    byId.set(row.id, squad);
  }
  return [...byId.values()];
}

export async function latestSquadVersion(eventId: string, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db.execute<{ version: number | null }>(sql`select max(version) as version from squads where event_id = ${eventId}`);
  return row?.version ?? 0;
}

/** Inserts one version of an event's squads; teams keep their order. */
export async function insertSquadVersion(eventId: string, version: number, teams: readonly { userId: string; roleLabel: string | null }[][], tx: Tx): Promise<string[]> {
  const ids: string[] = [];
  for (const team of teams) {
    const [squad] = await tx.insert(squads).values({ eventId, version }).returning({ id: squads.id });
    if (!squad) throw new Error('squad insert returned no row');
    ids.push(squad.id);
    if (team.length > 0) await tx.insert(squadMembers).values(team.map((member) => ({ squadId: squad.id, userId: member.userId, roleLabel: member.roleLabel })));
  }
  return ids;
}

export async function getSquad(squadId: string, db: DbOrTx = getDb()) {
  const [row] = await db.select().from(squads).where(eq(squads.id, squadId));
  return row ?? null;
}

export type SwapRequestRow = typeof squadSwapRequests.$inferSelect;

/** Swap requests made against an event's squads of one version. */
export async function swapRequestsFor(eventId: string, version: number, db: DbOrTx = getDb()): Promise<(SwapRequestRow & { login: string | null })[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select r.id from squad_swap_requests r join squads s on s.id = r.to_squad_id
    where r.event_id = ${eventId} and s.version = ${version} order by r.created_at, r.id`);
  if (rows.length === 0) return [];
  const requests = await db.select().from(squadSwapRequests).where(inArray(squadSwapRequests.id, rows.map((row) => row.id)));
  const logins = await db.execute<{ user_id: string; login: string }>(sql`
    select user_id, login from github_identities where user_id in (select from_user from squad_swap_requests where event_id = ${eventId})`);
  const byUser = new Map(logins.map((row) => [row.user_id, row.login]));
  const order = new Map(rows.map((row, index) => [row.id, index]));
  return requests.map((request) => ({ ...request, login: byUser.get(request.fromUser) ?? null })).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function insertSwapRequest(eventId: string, fromUser: string, toSquadId: string, db: DbOrTx = getDb()): Promise<string> {
  const [row] = await db.insert(squadSwapRequests).values({ eventId, fromUser, toSquadId }).returning({ id: squadSwapRequests.id });
  if (!row) throw new Error('swap request insert returned no row');
  return row.id;
}

export async function lockSwapRequest(requestId: string, tx: Tx): Promise<SwapRequestRow | null> {
  const [row] = await tx.select().from(squadSwapRequests).where(eq(squadSwapRequests.id, requestId)).for('update');
  return row ?? null;
}

export async function setSwapRequestStatus(requestId: string, status: SwapRequestRow['status'], db: DbOrTx = getDb()): Promise<void> {
  await db.update(squadSwapRequests).set({ status }).where(eq(squadSwapRequests.id, requestId));
}

/** Moves a member from their squad of `version` into `toSquadId`, keeping their role label. */
export async function moveSquadMember(eventId: string, version: number, userId: string, toSquadId: string, tx: Tx): Promise<void> {
  const rows = await tx.execute<{ role_label: string | null }>(sql`
    delete from squad_members m using squads s
    where m.squad_id = s.id and s.event_id = ${eventId} and s.version = ${version} and m.user_id = ${userId}
    returning m.role_label`);
  await tx.insert(squadMembers).values({ squadId: toSquadId, userId, roleLabel: rows[0]?.role_label ?? null });
}

/** Marks a version final, with each squad's thread, and refuses the swap requests still waiting. */
export async function finalizeSquadVersion(eventId: string, threads: ReadonlyMap<string, string>, tx: Tx): Promise<void> {
  for (const [squadId, threadId] of threads) await tx.update(squads).set({ status: 'final', threadId }).where(eq(squads.id, squadId));
  await tx.update(squadSwapRequests).set({ status: 'rejected' }).where(and(eq(squadSwapRequests.eventId, eventId), eq(squadSwapRequests.status, 'pending')));
}
