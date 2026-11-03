import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildSquads,
  createEvent,
  createGroup,
  decideSquadSwap,
  finalizeSquads,
  getEventView,
  joinEvent,
  joinGroup,
  leaveEvent,
  listEvents,
  requestFormation,
  requestSquadSwap,
  squadNote,
} from './service';

let database: TestDatabase;
let counter = 0;
const NOW = new Date('2026-10-21T08:00:00Z');

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('react', 'React', '{}', '{}', 'a', now()), ('postgresql', 'PostgreSQL', '{}', '{}', 'b', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

async function university(countryCode = 'TL'): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`Squad Uni ${counter}`}, ${`squad-uni-${counter}`}, 'Testland', ${countryCode}, '{}', 'admin', 'x') returning id`;
  return row!.id;
}

type Person = { id: string; login: string; verified: boolean; universityId: string; timezone: string };

async function member(universityId: string, vector: Record<string, number> | null = null, activity: number | null = null): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `squadder-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${770_000 + counter}, ${login})`;
  if (vector) {
    await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                       values (${id}, '{}', ${database.sql.json(vector)}, ${Object.keys(vector)}, '{}', now())`;
  }
  if (activity !== null) {
    await database.sql`insert into persona_snapshots (user_id, metrics, labels, companion, computed_at)
                       values (${id}, ${database.sql.json({ activityScore: activity })}, '{}', ${database.sql.json({ seed: 1, speciesKey: 'x', paletteHex: '#000000', stage: 0, traits: [] })}, now())`;
  }
  return { id, login, verified: true, universityId, timezone: 'UTC' };
}

const event = { title: 'Hack Night', description: 'Build something in a weekend.', visibility: 'university', startsOn: '2026-10-24', endsOn: '2026-10-25', teamSize: 2 };
const kinds = async (userId: string) => (await database.sql<{ kind: string }[]>`select kind from notifications where user_id = ${userId} order by created_at`).map((row) => row.kind);

describe('events', () => {
  it('creates events with checked inputs and shows them by visibility', async () => {
    const uni = await university();
    const sameCountry = await university();
    const abroad = await university('ZZ');
    const organizer = await member(uni);
    await expect(createEvent(organizer, { ...event, title: '' }, NOW)).rejects.toMatchObject({ code: 'squads.title' });
    await expect(createEvent(organizer, { ...event, teamSize: 1 }, NOW)).rejects.toMatchObject({ code: 'squads.team_size' });
    await expect(createEvent(organizer, { ...event, startsOn: '2026-10-20' }, NOW)).rejects.toMatchObject({ code: 'squads.starts' });
    await expect(createEvent(organizer, { ...event, endsOn: '2026-10-23' }, NOW)).rejects.toMatchObject({ code: 'squads.ends' });
    await expect(createEvent({ ...organizer, verified: false }, event, NOW)).rejects.toMatchObject({ code: 'squads.verify_first' });

    const uniEvent = await createEvent(organizer, event, NOW);
    const countryEvent = await createEvent(organizer, { ...event, title: 'Country jam', visibility: 'country', teamSize: undefined }, NOW);
    const [stored] = await database.sql<{ starts_at: Date; ends_at: Date; team_size: number }[]>`select starts_at, ends_at, team_size from events where id = ${countryEvent}`;
    expect(stored).toEqual({ starts_at: new Date('2026-10-24T00:00:00Z'), ends_at: new Date('2026-10-26T00:00:00Z'), team_size: 4 });

    const classmate = await member(uni);
    const neighbour = await member(sameCountry);
    const far = await member(abroad);
    expect((await listEvents(classmate, NOW)).map((row) => row.id).sort()).toEqual([uniEvent, countryEvent].sort());
    expect((await listEvents(neighbour, NOW)).map((row) => row.id)).toEqual([countryEvent]);
    expect(await listEvents(far, NOW)).toEqual([]);
    await expect(getEventView(far, uniEvent)).rejects.toMatchObject({ code: 'squads.not_found' });
    // Over events drop off the list.
    expect(await listEvents(classmate, new Date('2026-10-27T00:00:00Z'))).toEqual([]);
  });
});

describe('joining and groups', () => {
  it('stores free time in the member’s timezone and keeps groups within a team', async () => {
    const uni = await university();
    const organizer = await member(uni);
    const id = await createEvent(organizer, event, NOW);
    const [a, b, c] = [await member(uni), await member(uni), await member(uni)];
    await expect(joinEvent(a, { eventId: id, availability: [{ weekday: 1, from: 10, to: 9 }] })).rejects.toThrow();
    await expect(joinEvent(a, { eventId: id, availability: [{ weekday: 1, from: 9, to: 12 }, { weekday: 1, from: 13, to: 15 }] })).rejects.toThrow();
    await joinEvent({ ...a, timezone: 'Asia/Karachi' }, { eventId: id, availability: [{ weekday: 6, from: 9, to: 17 }] });
    await joinEvent(b, { eventId: id });
    expect((await database.sql`select availability from event_participants where user_id = ${a.id}`)[0]?.availability).toEqual({
      timeZone: 'Asia/Karachi',
      blocks: [{ weekday: 6, from: 9, to: 17 }],
    });

    await expect(createGroup(c, { eventId: id })).rejects.toMatchObject({ code: 'squads.not_joined' });
    const code = await createGroup(a, { eventId: id });
    await expect(joinGroup(b, { eventId: id, code: 'nope' })).rejects.toMatchObject({ code: 'squads.no_group' });
    await joinGroup(b, { eventId: id, code: code.toUpperCase() });
    await joinEvent(c, { eventId: id });
    await expect(joinGroup(c, { eventId: id, code })).rejects.toMatchObject({ code: 'squads.group_full' });
    const view = await getEventView(a, id);
    expect(view.me).toMatchObject({ joined: true, groupCode: code, groupSize: 2, availability: [{ weekday: 6, from: 9, to: 17 }] });
    expect(view.participantLogins).toBeNull();
    expect((await getEventView(organizer, id)).participantLogins).toHaveLength(3);
    await leaveEvent(c, { eventId: id });
    expect((await getEventView(organizer, id)).participants).toBe(2);
  });
});

describe('formation, swaps and finalization', () => {
  it('forms role-balanced teams deterministically, lets a participant switch once, and finalizes into conversations', async () => {
    const uni = await university();
    const organizer = await member(uni);
    const id = await createEvent(organizer, event, NOW);
    const front = [await member(uni, { react: 1 }, 0.9), await member(uni, { react: 0.9 }, 0.1)];
    const back = [await member(uni, { postgresql: 1 }, 0.5), await member(uni, { postgresql: 0.8 }, 0.5)];
    for (const person of [...front, ...back]) await joinEvent(person, { eventId: id });

    await withSettings({ 'unlock.squads.minParticipants': 5 }, async () => {
      await expect(requestFormation(organizer, { eventId: id })).rejects.toMatchObject({ code: 'squads.locked' });
    });
    await expect(requestFormation(front[0]!, { eventId: id })).rejects.toMatchObject({ code: 'squads.not_organizer' });
    await withSettings({ 'unlock.squads.minParticipants': 4 }, async () => {
      expect(await requestFormation(organizer, { eventId: id })).toBe(1);
    });
    expect((await database.sql`select idempotency_key from jobs where type = 'form_squads' and payload->>'eventId' = ${id}`).map((row) => row.idempotency_key)).toEqual([`squads:${id}:1`]);
    await expect(joinEvent(await member(uni), { eventId: id })).rejects.toMatchObject({ code: 'squads.closed' });

    const built = await buildSquads(id, 1);
    expect(built?.teams).toBe(2);
    expect([...(built?.roles ?? [])].sort()).toEqual(['PostgreSQL', 'React']);
    expect(await buildSquads(id, 1)).toBeNull();
    const squads = (await getEventView(organizer, id)).squads;
    for (const squad of squads) {
      expect(squad.members.map((m) => m.roleLabel).sort()).toEqual(['PostgreSQL', 'React']);
    }
    expect(await kinds(front[0]!.id)).toEqual(['squads_proposed']);

    // The same event and version form the same teams again.
    await database.sql`delete from squads where event_id = ${id}`;
    await buildSquads(id, 1);
    const again = (await getEventView(organizer, id)).squads.map((squad) => squad.members.map((m) => m.userId).sort()).sort();
    expect(again).toEqual(squads.map((squad) => squad.members.map((m) => m.userId).sort()).sort());

    const current = (await getEventView(front[0]!, id));
    const other = current.squads.find((squad) => squad.id !== current.mySquadId)!;
    await expect(requestSquadSwap(front[0]!, { squadId: current.mySquadId })).rejects.toMatchObject({ code: 'squads.same_team' });
    const requestId = await requestSquadSwap(front[0]!, { squadId: other.id });
    await expect(requestSquadSwap(front[0]!, { squadId: other.id })).rejects.toMatchObject({ code: 'squads.one_swap' });
    expect(await kinds(organizer.id)).toEqual(['squad_swap_requested']);
    const organizerView = await getEventView(organizer, id);
    expect(organizerView.pendingSwaps).toEqual([{ id: requestId, login: front[0]!.login, toSquadId: other.id }]);
    await expect(decideSquadSwap(front[1]!, { requestId, accept: true })).rejects.toMatchObject({ code: 'squads.not_organizer' });
    await decideSquadSwap(organizer, { requestId, accept: true });
    const moved = (await getEventView(front[0]!, id));
    expect(moved.mySquadId).toBe(other.id);
    expect(moved.myRequest).toEqual({ toSquadId: other.id, status: 'done' });
    expect(await kinds(front[0]!.id)).toContain('squad_swap_decided');

    await finalizeSquads(organizer, { eventId: id });
    const final = await getEventView(front[0]!, id);
    expect(final.event.status).toBe('finalized');
    expect(final.squads.every((squad) => squad.status === 'final' && squad.threadId !== null)).toBe(true);
    const mine = final.squads.find((squad) => squad.id === final.mySquadId)!;
    const [note] = await database.sql<{ body: string }[]>`select body from messages where thread_id = ${mine.threadId}`;
    expect(note?.body).toBe(squadNote('Hack Night', mine.members));
    const members = await database.sql<{ user_id: string }[]>`select user_id from thread_members where thread_id = ${mine.threadId}`;
    expect(members.map((row) => row.user_id).sort()).toEqual(mine.members.map((m) => m.userId).sort());
    expect(await kinds(front[0]!.id)).toContain('squads_final');
    await expect(finalizeSquads(organizer, { eventId: id })).rejects.toMatchObject({ code: 'squads.not_forming' });
  });

  it('keeps a locked group together and refuses formation before teams exist to finalize', async () => {
    const uni = await university();
    const organizer = await member(uni);
    const id = await createEvent(organizer, { ...event, teamSize: 3 }, NOW);
    const people = [await member(uni, { react: 1 }), await member(uni, { react: 1 }), await member(uni, { postgresql: 1 }), await member(uni, { postgresql: 1 }), await member(uni), await member(uni)];
    for (const person of people) await joinEvent(person, { eventId: id });
    const code = await createGroup(people[0]!, { eventId: id });
    await joinGroup(people[1]!, { eventId: id, code });
    await withSettings({ 'unlock.squads.minParticipants': 6 }, async () => {
      await requestFormation(organizer, { eventId: id });
    });
    await expect(finalizeSquads(organizer, { eventId: id })).rejects.toMatchObject({ code: 'squads.not_ready' });
    await buildSquads(id, 1);
    const squads = (await getEventView(organizer, id)).squads;
    expect(squads).toHaveLength(2);
    const withGroup = squads.find((squad) => squad.members.some((m) => m.userId === people[0]!.id))!;
    expect(withGroup.members.map((m) => m.userId)).toContain(people[1]!.id);
    // The group (two React people) gets a PostgreSQL person to cover the missing role.
    expect(withGroup.members.some((m) => m.roleLabel === 'PostgreSQL')).toBe(true);
  });
});
