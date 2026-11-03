import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { answerQuestion, askQuestion, correctGraduation, enforceAlumniSla, getAlumni, passQuestion, questionNote, routeQuestion, transitionGraduates } from './service';

let database: TestDatabase;
let counter = 0;
const HOUR_MS = 3_600_000;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`
    insert into topics (slug, display_name, aliases, related, blob_sha, synced_at)
    values ('react', 'React', '{reactjs}', '{}', 'a', now()), ('docker', 'Docker', '{}', '{}', 'b', now()), ('interviews', 'Interviews', '{}', '{}', 'c', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

async function university(): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`Alumni Uni ${counter}`}, ${`alumni-uni-${counter}`}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  return row!.id;
}

type Person = { id: string; login: string; verified: boolean; universityId: string };

async function member(universityId: string, options: { role?: 'student' | 'alumni'; gradYear?: number; vector?: Record<string, number>; ghost?: boolean } = {}): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `alum-${counter}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, role, grad_year, ghost_mode)
                     values (${id}, 'UTC', ${universityId}, now(), ${options.role ?? 'student'}, ${options.gradYear ?? null}, ${options.ghost ?? false})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${660_000 + counter}, ${login})`;
  if (options.vector) {
    await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                       values (${id}, '{}', ${database.sql.json(options.vector)}, ${Object.keys(options.vector)}, '{}', now())`;
  }
  return { id, login, verified: true, universityId };
}

const routes = (questionId: string) =>
  database.sql<{ alumni_user_id: string; round: number; status: string }[]>`
    select alumni_user_id, round, status from question_routes where question_id = ${questionId} order by alumni_user_id`;
const question = async (questionId: string) =>
  (await database.sql<{ status: string; round: number; tags: string[]; answered_by: string | null; thread_id: string | null }[]>`
    select status, round, tags, answered_by, thread_id from alumni_questions where id = ${questionId}`)[0]!;
const kinds = async (userId: string) => (await database.sql<{ kind: string }[]>`select kind from notifications where user_id = ${userId} order by created_at`).map((row) => row.kind);
const routeJobs = (questionId: string) =>
  database.sql<{ idempotency_key: string }[]>`select idempotency_key from jobs where type = 'alumni_route' and payload->>'questionId' = ${questionId} order by created_at`;

const open = { 'unlock.alumni.minAlumni': 1 } as const;

describe('transitionGraduates', () => {
  it('makes verified students alumni once their graduation year is before the cutoff, and tells them', async () => {
    const uni = await university();
    const graduated = await member(uni, { gradYear: 2025 });
    const current = await member(uni, { gradYear: 2026 });
    await transitionGraduates(new Date('2026-06-15T00:00:00Z'));
    expect((await database.sql`select role from profiles where user_id = ${graduated.id}`)[0]?.role).toBe('student');

    await transitionGraduates(new Date('2026-07-02T00:00:00Z'));
    expect((await database.sql`select role from profiles where user_id = ${graduated.id}`)[0]?.role).toBe('alumni');
    expect((await database.sql`select role from profiles where user_id = ${current.id}`)[0]?.role).toBe('student');
    expect(await kinds(graduated.id)).toEqual(['became_alumni']);
    expect(await kinds(current.id)).toEqual([]);
  });
});

describe('askQuestion and routing', () => {
  it('stays closed until the university has enough alumni, and checks length and topics', async () => {
    const uni = await university();
    const asker = await member(uni);
    await expect(askQuestion(asker, { body: 'How do I prepare for interviews?' })).rejects.toMatchObject({ code: 'alumni.locked' });
    await member(uni, { role: 'alumni', vector: { react: 1 } });
    await withSettings({ ...open, 'alumni.questionMaxChars': 20 }, async () => {
      await expect(askQuestion(asker, { body: 'x'.repeat(21) })).rejects.toMatchObject({ code: 'alumni.too_long' });
      await expect(askQuestion(asker, { body: '   ' })).rejects.toMatchObject({ code: 'alumni.empty' });
      await expect(askQuestion(asker, { body: 'Help', tags: ['cobol-on-mars'] })).rejects.toMatchObject({ code: 'alumni.unknown_tags' });
    });
  });

  it('tags from picks and keyphrases, routes to the best-matched alumni and re-routes when a round runs out', async () => {
    const uni = await university();
    const asker = await member(uni);
    const reactAlum = await member(uni, { role: 'alumni', vector: { react: 1 } });
    const dockerAlum = await member(uni, { role: 'alumni', vector: { docker: 1 } });
    const ghost = await member(uni, { role: 'alumni', vector: { react: 1 }, ghost: true });
    const blocked = await member(uni, { role: 'alumni', vector: { react: 1 } });
    await database.sql`insert into blocks (blocker, blocked) values (${blocked.id}, ${asker.id})`;
    await member(uni, { role: 'alumni' }); // no skill vector: nothing to match on yet

    await withSettings({ ...open, 'alumni.routeTopK': 1 }, async () => {
      const id = await askQuestion(asker, { body: 'Which react state library did you use in production, and why?', tags: ['Docker'], anonymous: true });
      const stored = await question(id);
      expect(stored.tags).toEqual(expect.arrayContaining(['docker', 'react']));
      expect(stored.tags[0]).toBe('docker');
      expect((await routeJobs(id)).map((row) => row.idempotency_key)).toEqual([`alumni:${id}:1`]);

      const now = new Date();
      expect(await routeQuestion(id, 1, now)).toEqual({ routed: 1, expired: false });
      const [first] = await routes(id);
      expect([reactAlum.id, dockerAlum.id]).toContain(first?.alumni_user_id);
      expect(first?.alumni_user_id).not.toBe(ghost.id);
      // Running the same round twice routes nothing new.
      expect(await routeQuestion(id, 1, now)).toEqual({ routed: 0, expired: false });
      expect(await kinds(first!.alumni_user_id)).toEqual(['alumni_question']);

      // Nobody answers within the SLA: the route expires and round 2 is queued.
      await withSettings({ 'alumni.slaHours': 1 }, async () => {
        const later = new Date(now.getTime() + 2 * HOUR_MS);
        const sla = await enforceAlumniSla(later);
        expect(sla.expiredRoutes).toBeGreaterThanOrEqual(1);
        expect((await routeJobs(id)).map((row) => row.idempotency_key)).toEqual([`alumni:${id}:1`, `alumni:${id}:2`]);
        expect(await routeQuestion(id, 2, later)).toEqual({ routed: 1, expired: false });
      });
      const second = (await routes(id)).find((route) => route.round === 2);
      expect(second?.alumni_user_id).not.toBe(first?.alumni_user_id);
      expect([reactAlum.id, dockerAlum.id]).toContain(second?.alumni_user_id);

      // The last matching alumnus passes; the next round has nobody new, so the question expires.
      await passQuestion({ id: second!.alumni_user_id }, { questionId: id });
      expect((await routeJobs(id)).map((row) => row.idempotency_key)).toContain(`alumni:${id}:3`);
      const third = await routeQuestion(id, 3, new Date());
      // The alumnus without a skill vector is never a candidate.
      expect(third).toEqual({ routed: 0, expired: true });
      expect((await question(id)).status).toBe('expired');
      expect(await kinds(asker.id)).toEqual(['alumni_expired']);
    });
  });

  it('expires a question past alumni.maxRounds', async () => {
    const uni = await university();
    const asker = await member(uni);
    await member(uni, { role: 'alumni', vector: { react: 1 } });
    await withSettings({ ...open, 'alumni.maxRounds': 1 }, async () => {
      const id = await askQuestion(asker, { body: 'Any advice on react interviews?' });
      expect(await routeQuestion(id, 2, new Date())).toEqual({ routed: 0, expired: true });
    });
  });
});

describe('answerQuestion', () => {
  it('opens a conversation quoting the question, ends the other routes and tells the asker', async () => {
    const uni = await university();
    const asker = await member(uni);
    const [one, two] = [await member(uni, { role: 'alumni', vector: { react: 1 } }), await member(uni, { role: 'alumni', vector: { react: 0.5 } })];
    const outsider = await member(uni, { role: 'alumni', vector: { react: 1 } });
    await withSettings({ ...open, 'alumni.routeTopK': 2 }, async () => {
      const id = await askQuestion(asker, { body: 'How did you learn react testing?', tags: ['react'], anonymous: true });
      // Fill the outsider's capacity so the round goes to the other two.
      await withSettings({ 'alumni.maxOpenPerAlumnus': 1 }, async () => {
        const busyId = await askQuestion(asker, { body: 'Another react question', tags: ['react'] });
        await database.sql`insert into question_routes (question_id, alumni_user_id, round) values (${busyId}, ${outsider.id}, 1)`;
        await database.sql`update alumni_questions set round = 1 where id = ${busyId}`;
        await routeQuestion(id, 1, new Date());
      });
      expect((await routes(id)).map((route) => route.alumni_user_id).sort()).toEqual([one.id, two.id].sort());

      await expect(answerQuestion({ id: outsider.id }, { questionId: id })).rejects.toMatchObject({ code: 'alumni.not_routed' });
      const threadId = await answerQuestion({ id: one.id }, { questionId: id });
      const stored = await question(id);
      expect(stored).toMatchObject({ status: 'answered', answered_by: one.id, thread_id: threadId });
      expect(Object.fromEntries((await routes(id)).map((route) => [route.alumni_user_id, route.status]))).toEqual({ [one.id]: 'answered', [two.id]: 'passed' });
      const members = await database.sql<{ user_id: string }[]>`select user_id from thread_members where thread_id = ${threadId}`;
      expect(members.map((row) => row.user_id).sort()).toEqual([asker.id, one.id].sort());
      const [note] = await database.sql<{ kind: string; body: string }[]>`select kind, body from messages where thread_id = ${threadId}`;
      expect(note).toEqual({ kind: 'system', body: questionNote('How did you learn react testing?') });
      expect(await kinds(asker.id)).toContain('alumni_answered');
      expect(await database.sql`select source from connections where (user_a = ${asker.id} and user_b = ${one.id}) or (user_a = ${one.id} and user_b = ${asker.id})`).toEqual([{ source: 'alumni' }]);
      await expect(answerQuestion({ id: two.id }, { questionId: id })).rejects.toMatchObject({ code: 'alumni.closed' });
    });
  });
});

describe('getAlumni and correctGraduation', () => {
  it('shows progress until unlocked, then questions both ways, revealing an anonymous asker only after the answer', async () => {
    const uni = await university();
    const asker = await member(uni);
    const alum = await member(uni, { role: 'alumni', gradYear: 2020, vector: { react: 1 } });
    expect(await getAlumni(asker)).toEqual({ state: 'locked', current: 1, required: 5 });
    await withSettings(open, async () => {
      const id = await askQuestion(asker, { body: 'How did you find your first react job?', tags: ['react'], anonymous: true });
      await routeQuestion(id, 1, new Date());
      const mine = await getAlumni(asker);
      expect(mine).toMatchObject({ state: 'open', inbox: null, graduation: null, rules: { maxChars: 600, slaHours: 48, maxRounds: 3 } });
      if (mine.state !== 'open') throw new Error('expected open');
      expect(mine.asked.map((question) => question.id)).toEqual([id]);

      const before = await getAlumni(alum, new Date('2026-10-21T00:00:00Z'));
      if (before.state !== 'open') throw new Error('expected open');
      expect(before.inbox).toEqual([expect.objectContaining({ questionId: id, askerLogin: null, routeStatus: 'pending', status: 'open' })]);
      expect(before.graduation).toEqual({ gradYear: 2020, years: { min: 1966, max: 2034 } });
      await answerQuestion(alum, { questionId: id });
      const after = await getAlumni(alum);
      if (after.state !== 'open') throw new Error('expected open');
      expect(after.inbox?.[0]).toMatchObject({ askerLogin: asker.login, routeStatus: 'answered' });
      const answered = await getAlumni(asker);
      if (answered.state !== 'open') throw new Error('expected open');
      expect(answered.asked[0]).toMatchObject({ status: 'answered', answeredByLogin: alum.login });
    });
  });

  it('lets an alumnus correct their year, back to student when it has not passed', async () => {
    const uni = await university();
    const alum = await member(uni, { role: 'alumni', gradYear: 2024 });
    const student = await member(uni, { gradYear: 2027 });
    const now = new Date('2026-10-21T00:00:00Z');
    await expect(correctGraduation(student, { gradYear: 2020 }, now)).rejects.toMatchObject({ code: 'alumni.not_alumnus' });
    await expect(correctGraduation(alum, { gradYear: 1900 }, now)).rejects.toMatchObject({ code: 'alumni.grad_year' });
    expect(await correctGraduation(alum, { gradYear: 2023 }, now)).toBe('alumni');
    expect(await correctGraduation(alum, { gradYear: 2027 }, now)).toBe('student');
    expect(await database.sql`select role, grad_year from profiles where user_id = ${alum.id}`).toEqual([{ role: 'student', grad_year: 2027 }]);
    // The next transition leaves the corrected year alone.
    await transitionGraduates(now);
    expect((await database.sql`select role from profiles where user_id = ${alum.id}`)[0]?.role).toBe('student');
  });
});
