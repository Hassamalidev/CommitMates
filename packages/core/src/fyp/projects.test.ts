import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getMember } from '../profiles/service';

import {
  checkIdeaAtUniversity,
  confirmDetectedProject,
  detectMemberProjects,
  dismissDetectedProject,
  getPastProjects,
  removePastProject,
  submitPastProject,
  universityMatches,
} from './projects';

const english = JSON.parse(readFileSync(new URL('../../../algorithms/src/__fixtures__/stopwords/en.json', import.meta.url), 'utf8')) as string[];
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let counter = 0;
let readmes: Record<string, string> = {};
const NOW = new Date('2026-11-03T10:00:00Z');

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core', 'content-type': 'text/plain' };

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await database.sql`insert into stopwords (language, words, checksum, synced_at) values ('en', ${english}, 'x', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
  readmes = {};
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })),
    http.get(`${API}/repos/:owner/:repo/readme`, ({ params }) => {
      const readme = readmes[`${params.owner as string}/${params.repo as string}`];
      return readme === undefined ? HttpResponse.json({}, { status: 404, headers }) : new HttpResponse(readme, { headers });
    }),
  );
});

async function university(): Promise<string> {
  counter += 1;
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values (${`FYP Uni ${counter}`}, ${`fyp-uni-${counter}`}, 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  return row!.id;
}

async function member(universityId: string, repos: { name: string; description: string; readme?: string }[] = []) {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `senior-${counter}`;
  const githubId = 880_000 + counter;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, grad_year) values (${id}, 'UTC', ${universityId}, now(), 2024)`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${githubId}, ${login})`;
  const repoIds: number[] = [];
  for (const repo of repos) {
    counter += 1;
    const repoId = 990_000 + counter;
    repoIds.push(repoId);
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, is_fork, fetched_at)
                       values (${repoId}, ${githubId}, ${`${login}/${repo.name}`}, ${repo.name}, ${repo.description}, '{}', false, now())`;
    if (repo.readme !== undefined) readmes[`${login}/${repo.name}`] = repo.readme;
  }
  const loaded = await getMember(id);
  if (!loaded) throw new Error('member not loaded');
  return { member: loaded, repoIds };
}

const projects = (universityId: string) =>
  database.sql<{ repo_github_id: string; confirmed: boolean; auto_detected: boolean; year: number | null; dismissed_at: Date | null; corpus_text: string | null }[]>`
    select repo_github_id, confirmed, auto_detected, year, dismissed_at, corpus_text from fyp_projects where university_id = ${universityId} order by repo_github_id`;

describe('submitting past projects', () => {
  it('confirms a member’s own repository with its README as corpus text, feeds Senior’s Legacy, and refuses others', async () => {
    const uni = await university();
    const { member: senior, repoIds } = await member(uni, [{ name: 'attend', description: 'Face attendance', readme: '# Attendance\nA **smart** attendance system with face recognition.' }]);
    const { member: other } = await member(uni);
    const id = await submitPastProject(senior, { repoGithubId: repoIds[0], year: '2024' }, NOW);
    const [row] = await projects(uni);
    expect(row).toMatchObject({ confirmed: true, auto_detected: false, year: 2024 });
    expect(row?.corpus_text).toBe('attend\nFace attendance\nAttendance A smart attendance system with face recognition.');
    expect(await database.sql`select source, accepts_questions from legacy_entries where owner_user_id = ${senior.id}`).toEqual([{ source: 'fyp', accepts_questions: false }]);
    await expect(submitPastProject(other, { repoGithubId: repoIds[0] }, NOW)).rejects.toMatchObject({ code: 'fyp.not_yours' });
    await expect(submitPastProject(senior, { repoGithubId: repoIds[0], year: 1900 }, NOW)).rejects.toMatchObject({ code: 'fyp.year' });
    await expect(submitPastProject({ ...senior, verified: false }, { repoGithubId: repoIds[0] }, NOW)).rejects.toMatchObject({ code: 'fyp.verify_first' });

    expect((await getPastProjects(senior)).map((project) => [project.id, project.fullName])).toEqual([[id, `${senior.login}/attend`]]);
    await expect(removePastProject(other, { projectId: id })).rejects.toMatchObject({ code: 'fyp.not_found' });
    await removePastProject(senior, { projectId: id });
    expect(await projects(uni)).toEqual([]);
    expect(await database.sql`select 1 from legacy_entries where owner_user_id = ${senior.id}`).toHaveLength(0);
  });
});

describe('detection', () => {
  it('proposes repositories whose README mentions a final-year project, once, and waits for the owner', async () => {
    const uni = await university();
    const { member: senior, repoIds } = await member(uni, [
      { name: 'thesis', description: 'Crop disease detection', readme: 'Our Final Year Project at the university: crop disease detection from leaf photos.' },
      { name: 'notes', description: 'Lecture notes', readme: 'Notes, not a project. typography and fyprint are not matches.' },
      { name: 'empty', description: 'No readme' },
    ]);
    expect(await detectMemberProjects(senior.id, Date.now() + 60_000)).toEqual({ detected: 1, done: true });
    expect((await projects(uni)).map((row) => [Number(row.repo_github_id), row.confirmed, row.auto_detected])).toEqual([[repoIds[0], false, true]]);
    expect((await database.sql`select kind from notifications where user_id = ${senior.id}`).map((row) => row.kind)).toEqual(['fyp_detected']);
    // A second run proposes nothing new.
    expect(await detectMemberProjects(senior.id, Date.now() + 60_000)).toEqual({ detected: 0, done: true });

    const [pending] = await getPastProjects(senior);
    await confirmDetectedProject(senior, { projectId: pending!.id, year: '' }, NOW);
    expect((await projects(uni))[0]).toMatchObject({ confirmed: true, year: null });
    await expect(dismissDetectedProject(senior, { projectId: pending!.id }, NOW)).rejects.toMatchObject({ code: 'fyp.confirmed' });

    // A detection the owner turns down stays recorded, so it is never proposed again.
    const { member: another } = await member(uni, [{ name: 'fyp', description: 'Library app', readme: 'FYP: a library app.' }]);
    await detectMemberProjects(another.id, Date.now() + 60_000);
    const [theirs] = await getPastProjects(another);
    await dismissDetectedProject(another, { projectId: theirs!.id }, NOW);
    expect(await getPastProjects(another)).toEqual([]);
    expect(await detectMemberProjects(another.id, Date.now() + 60_000)).toEqual({ detected: 0, done: true });
  });
});

describe('university matches', () => {
  const idea = {
    title: 'Smart attendance with face recognition',
    description: 'A smart attendance system that recognizes students with face recognition from a classroom camera and shows a teacher dashboard.',
  };

  it('stays off until fyp.minCorpus projects are confirmed, then ranks the closest past projects', async () => {
    const uni = await university();
    const { member: a, repoIds: [attend] } = await member(uni, [{ name: 'attend', description: 'Attendance', readme: idea.description }]);
    const { member: b, repoIds: [weather] } = await member(uni, [{ name: 'weather', description: 'Weather station', readme: 'A weather station that logs temperature and humidity.' }]);
    await submitPastProject(a, { repoGithubId: attend }, NOW);
    await submitPastProject(b, { repoGithubId: weather }, NOW);
    expect(await universityMatches(uni, idea)).toBeNull();
    await withSettings({ 'fyp.minCorpus': 2 }, async () => {
      const matches = await universityMatches(uni, idea);
      expect(matches?.map((match) => match.fullName)).toEqual([`${a.login}/attend`, `${b.login}/weather`]);
      expect(matches?.[0]?.band).toBe('very-similar');
      expect(matches?.[1]?.band).toBe('loose');
      expect(await checkIdeaAtUniversity(a, idea)).toEqual(matches);
      expect(await checkIdeaAtUniversity({ verified: false, universityId: uni }, idea)).toBeNull();
    });
  });
});
