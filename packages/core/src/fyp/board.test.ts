import { readFileSync } from 'node:fs';

import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FYP_NOTE_PREFIX,
  applySupervisor,
  checkIdea,
  decideSupervisor,
  expressInterest,
  fypBoardAccess,
  getIdea,
  listIdeas,
  listSupervisors,
  pendingSupervisors,
  pickTeam,
  postIdea,
  setIdeaStatus,
  withdrawInterest,
} from './board';

const english = JSON.parse(readFileSync(new URL('../../../algorithms/src/__fixtures__/stopwords/en.json', import.meta.url), 'utf8')) as string[];
let database: TestDatabase;
let counter = 0;
const open = { 'unlock.fypBoard.minMembers': 1 } as const;

const IDEA = {
  title: 'Smart attendance with face recognition',
  description: 'A smart attendance system that recognizes students with face recognition from a classroom camera and shows a teacher dashboard.',
};

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`insert into stopwords (language, words, checksum, synced_at) values ('en', ${english}, 'x', now())`;
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('machine-learning', 'Machine learning', '{}', '{}', 'a', now()), ('computer-vision', 'Computer vision', '{}', '{}', 'b', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

async function university(): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`Board Uni ${counter}`}, ${`board-uni-${counter}`}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  return row!.id;
}

type Role = 'student' | 'supervisor_pending' | 'supervisor';
async function member(universityId: string, role: Role = 'student') {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `boarder-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, role) values (${id}, 'UTC', ${universityId}, now(), ${role})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${660_000 + counter}, ${login})`;
  return { id, login, verified: true, universityId, roles: [] as { role: 'admin' | 'uni_moderator'; universityId: string | null }[] };
}

const kinds = async (userId: string) => (await database.sql<{ kind: string }[]>`select kind from notifications where user_id = ${userId} order by created_at`).map((row) => row.kind);

describe('access', () => {
  it('is closed until unlock.fypBoard.minMembers members have joined', async () => {
    const uni = await university();
    const student = await member(uni);
    expect(await fypBoardAccess(student)).toEqual({ state: 'locked', current: 1, required: 10 });
    await expect(postIdea(student, IDEA)).rejects.toMatchObject({ code: 'fyp.locked' });
    expect(await fypBoardAccess({ ...student, verified: false })).toEqual({ state: 'unverified' });
    await withSettings(open, async () => {
      expect(await fypBoardAccess(student)).toEqual({ state: 'open' });
    });
  });
});

describe('supervisors', () => {
  it('applies with known areas, and only a moderator of that university or an admin decides, audited', async () => {
    const uni = await university();
    const elsewhere = await university();
    const student = await member(uni);
    const pending = await member(uni, 'supervisor_pending');
    await expect(applySupervisor(student, { areas: ['machine-learning'] })).rejects.toMatchObject({ code: 'fyp.not_supervisor' });
    await expect(applySupervisor(pending, { areas: ['cobol-on-mars'] })).rejects.toMatchObject({ code: 'fyp.unknown_areas' });
    await expect(applySupervisor(pending, { areas: [] })).rejects.toMatchObject({ code: 'fyp.no_areas' });
    await applySupervisor(pending, { areas: ['Machine Learning', 'computer-vision'] });

    const moderator = { ...(await member(uni)), roles: [{ role: 'uni_moderator' as const, universityId: uni }] };
    const other = { ...(await member(elsewhere)), roles: [{ role: 'uni_moderator' as const, universityId: elsewhere }] };
    expect((await pendingSupervisors(moderator)).map((row) => [row.login, row.areas])).toEqual([[pending.login, ['machine-learning', 'computer-vision']]]);
    expect(await pendingSupervisors(other)).toEqual([]);
    await expect(pendingSupervisors(student)).rejects.toMatchObject({ code: 'moderation.forbidden' });
    await expect(decideSupervisor(other, { userId: pending.id, universityId: uni, approve: true })).rejects.toMatchObject({ code: 'fyp.not_your_university' });

    await decideSupervisor(moderator, { userId: pending.id, universityId: uni, approve: true });
    expect((await database.sql`select role from profiles where user_id = ${pending.id}`)[0]?.role).toBe('supervisor');
    expect(await database.sql`select action from audit_log where target_id = ${pending.id}`).toEqual([{ action: 'fyp.supervisor_approved' }]);
    expect(await kinds(pending.id)).toEqual(['supervisor_approved']);
    await expect(decideSupervisor(moderator, { userId: pending.id, universityId: uni, approve: true })).rejects.toMatchObject({ code: 'fyp.no_application' });
    await withSettings(open, async () => {
      expect((await listSupervisors(student)).map((row) => row.login)).toEqual([pending.login]);
    });

    const declined = await member(uni, 'supervisor_pending');
    await applySupervisor(declined, { areas: ['machine-learning'] });
    await decideSupervisor({ id: moderator.id, roles: [{ role: 'admin', universityId: null }] }, { userId: declined.id, universityId: uni, approve: false });
    expect(await database.sql`select 1 from fyp_supervisors where user_id = ${declined.id}`).toHaveLength(0);
    expect(await kinds(declined.id)).toEqual(['supervisor_rejected']);
  });
});

describe('ideas', () => {
  it('checks against past projects, posts with keyphrases, and lists with filters and blocks', async () => {
    const uni = await university();
    const author = await member(uni);
    const viewer = await member(uni);
    const blocked = await member(uni);
    await database.sql`insert into blocks (blocker, blocked) values (${blocked.id}, ${author.id})`;
    await withSettings({ ...open, 'fyp.minCorpus': 1 }, async () => {
      await database.sql`insert into fyp_projects (university_id, repo_github_id, confirmed, corpus_text) values (${uni}, 12345, true, ${IDEA.description})`;
      const check = await checkIdea(author, IDEA);
      expect(check.keyphrases.length).toBeGreaterThan(2);
      expect(check.university?.[0]?.band).toBe('very-similar');

      await expect(postIdea(author, { ...IDEA, supervisorIdea: true })).rejects.toMatchObject({ code: 'fyp.not_supervisor' });
      await expect(postIdea(author, { ...IDEA, description: 'Too short.' })).rejects.toThrow();
      const id = await postIdea(author, IDEA);
      const [stored] = await database.sql<{ keyphrases: string[]; status: string }[]>`select keyphrases, status from fyp_ideas where id = ${id}`;
      expect(stored?.status).toBe('open');
      expect(stored?.keyphrases.length).toBeGreaterThan(2);

      expect((await listIdeas(viewer)).map((idea) => idea.id)).toEqual([id]);
      expect(await listIdeas(blocked)).toEqual([]);
      expect(await listIdeas(viewer, { tag: stored?.keyphrases[0] })).toHaveLength(1);
      expect(await listIdeas(viewer, { tag: 'no such phrase' })).toEqual([]);
      expect(await listIdeas(viewer, { supervisorOnly: true })).toEqual([]);
      await expect(getIdea(blocked, id)).rejects.toMatchObject({ code: 'fyp.no_idea' });
      expect((await getIdea(viewer, id)).university?.[0]?.band).toBe('very-similar');
    });
  });

  it('collects interest, lets the author pick a team into a conversation, and change the status', async () => {
    const uni = await university();
    const author = await member(uni);
    const [first, second, late] = [await member(uni), await member(uni), await member(uni)];
    await withSettings(open, async () => {
      const id = await postIdea(author, IDEA);
      await expect(expressInterest(author, { ideaId: id, message: 'me' })).rejects.toMatchObject({ code: 'fyp.own_idea' });
      await expect(expressInterest(first, { ideaId: id, message: '   ' })).rejects.toMatchObject({ code: 'fyp.no_message' });
      await withSettings({ 'fyp.interestMaxChars': 5 }, async () => {
        await expect(expressInterest(first, { ideaId: id, message: 'far too long' })).rejects.toMatchObject({ code: 'fyp.message_long' });
      });
      await expressInterest(first, { ideaId: id, message: 'I built a face detector last term.' });
      await expressInterest(second, { ideaId: id, message: 'I can do the dashboard.' });
      await expressInterest(late, { ideaId: id, message: 'Count me in.' });
      await withdrawInterest(late, { ideaId: id });
      expect(await kinds(author.id)).toEqual(['fyp_interest', 'fyp_interest', 'fyp_interest']);

      const asAuthor = await getIdea(author, id);
      expect(asAuthor.interest?.map((entry) => entry.login)).toEqual([first.login, second.login]);
      expect((await getIdea(first, id)).interest).toBeNull();
      expect((await getIdea(first, id)).myInterest).toBe('I built a face detector last term.');

      await expect(pickTeam(first, { ideaId: id, userIds: [second.id] })).rejects.toMatchObject({ code: 'fyp.no_idea' });
      await expect(pickTeam(author, { ideaId: id, userIds: [late.id] })).rejects.toMatchObject({ code: 'fyp.not_interested' });
      const threadId = await pickTeam(author, { ideaId: id, userIds: [first.id, second.id] });
      const members = await database.sql<{ user_id: string }[]>`select user_id from thread_members where thread_id = ${threadId}`;
      expect(members.map((row) => row.user_id).sort()).toEqual([author.id, first.id, second.id].sort());
      expect((await database.sql`select body from messages where thread_id = ${threadId}`)[0]?.body).toBe(`${FYP_NOTE_PREFIX}${JSON.stringify({ title: IDEA.title })}`);
      expect(await kinds(first.id)).toEqual(['fyp_team']);
      expect((await getIdea(first, id)).threadId).toBe(threadId);
      expect((await getIdea(late, id)).threadId).toBeNull();
      await expect(pickTeam(author, { ideaId: id, userIds: [first.id] })).rejects.toMatchObject({ code: 'fyp.team_formed' });

      await setIdeaStatus(author, { ideaId: id, status: 'taken' });
      expect((await getIdea(author, id)).idea.status).toBe('taken');
      await expect(expressInterest(late, { ideaId: id, message: 'Again?' })).rejects.toMatchObject({ code: 'fyp.closed' });
      await setIdeaStatus(author, { ideaId: id, status: 'open' });
      expect((await getIdea(author, id)).idea.status).toBe('team_forming');
      await setIdeaStatus(author, { ideaId: id, status: 'archived' });
      expect(await listIdeas(first)).toEqual([]);
      expect(await listIdeas(first, { status: 'archived' })).toHaveLength(1);
      await expect(setIdeaStatus(first, { ideaId: id, status: 'taken' })).rejects.toMatchObject({ code: 'fyp.no_idea' });
    });
  });

  it('lets approved supervisors post supervisor ideas', async () => {
    const uni = await university();
    const supervisor = await member(uni, 'supervisor_pending');
    await applySupervisor(supervisor, { areas: ['computer-vision'] });
    await decideSupervisor({ id: supervisor.id, roles: [{ role: 'admin', universityId: null }] }, { userId: supervisor.id, universityId: uni, approve: true });
    await withSettings(open, async () => {
      const id = await postIdea(supervisor, { ...IDEA, supervisorIdea: true });
      expect((await listIdeas(supervisor, { supervisorOnly: true })).map((idea) => idea.id)).toEqual([id]);
      expect((await listSupervisors(supervisor))[0]).toMatchObject({ login: supervisor.login, openIdeas: 1 });
    });
  });
});
