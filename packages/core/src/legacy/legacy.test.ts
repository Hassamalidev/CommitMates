import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { clearHandlers, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import { campusUnlocks } from '../universities/campus';

import { addLegacyEntry, askLegacyAuthor, getLegacy, getLegacyDetail, removeLegacyEntry, standingOf } from './service';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let otherUni: string;
let department: string;
let counter = 0;
const YEAR = new Date().getUTCFullYear();

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const headers = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'core' });

type Person = { id: string; login: string; githubId: number; verified: boolean; universityId: string };

async function member(universityId: string = uni, profile: { role?: string; gradYear?: number | null; visibility?: string; departmentId?: string | null } = {}): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `legacy-${counter}`;
  const githubId = 110_000 + counter;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, role, grad_year, visibility, department_id)
                     values (${id}, 'UTC', ${universityId}, now(), ${profile.role ?? 'student'}, ${profile.gradYear ?? null}, ${profile.visibility ?? 'university'}, ${profile.departmentId ?? null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${githubId}, ${login})`;
  return { id, login, githubId, verified: true, universityId };
}

async function repo(owner: Person, name: string, extra: { description?: string; topics?: string[]; stars?: number } = {}): Promise<number> {
  counter += 1;
  const githubId = 7_700_000 + counter;
  await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, stars, is_fork, fetched_at)
                     values (${githubId}, ${owner.githubId}, ${`${owner.login}/${name}`}, ${name}, ${extra.description ?? null}, ${extra.topics ?? []}, ${extra.stars ?? 0}, false, now())`;
  return githubId;
}

const open = <T,>(run: () => Promise<T>) => withSettings({ 'unlock.legacy.minProjects': 1 }, run);

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Legacy Uni', 'legacy-uni', 'Testland', 'TL', '{}', 'admin', 'l'), ('Other Legacy Uni', 'other-legacy', 'Testland', 'TL', '{}', 'admin', 'm') returning id`;
  uni = rows[0]!.id;
  otherUni = rows[1]!.id;
  const [dept] = await database.sql<{ id: string }[]>`
    insert into departments (university_id, name, normalized_name) values (${uni}, 'Computer Science', 'computer science') returning id`;
  department = dept!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
  clearHandlers();
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() } } })));
});

describe('showcase entries', () => {
  it('adds the member’s own repository with tags from its topics and dependencies, and refuses others', async () => {
    const owner = await member(uni, { gradYear: YEAR });
    const other = await member();
    const repoId = await repo(owner, 'campus-map', { topics: ['maps', 'React'] });
    await database.sql`insert into repo_dependencies (repo_github_id, ecosystem, package_name, is_dev) values (${repoId}, 'npm', 'leaflet', false)`;
    await database.sql`insert into package_meta (ecosystem, name, keywords, classifiers, gh_topics, derived_tags, fetched_at, expires_at)
                       values ('npm', 'leaflet', '{}', '{}', '{}', '{gis,maps}', now(), now() + interval '30 days')`;
    const entryId = await addLegacyEntry(owner, { repoGithubId: repoId, blurb: 'Indoor maps of the campus.', acceptsQuestions: true });
    const [row] = await database.sql`select tags, grad_year, blurb, source from legacy_entries where id = ${entryId}`;
    expect(row).toEqual({ tags: ['gis', 'maps', 'react'], grad_year: YEAR, blurb: 'Indoor maps of the campus.', source: 'showcase' });

    await expect(addLegacyEntry(other, { repoGithubId: repoId, blurb: '', acceptsQuestions: true })).rejects.toMatchObject({ code: 'legacy.not_yours' });
    await expect(addLegacyEntry(owner, { repoGithubId: repoId, blurb: 'x'.repeat(281), acceptsQuestions: true })).rejects.toMatchObject({ code: 'legacy.blurb_long' });
    await expect(removeLegacyEntry(other, { entryId })).rejects.toMatchObject({ code: 'legacy.not_found' });
    await removeLegacyEntry(owner, { entryId });
    expect(await database.sql`select 1 from legacy_entries where id = ${entryId}`).toEqual([]);
  });

  it('labels alumni and seniors from role and graduation year', () => {
    expect(standingOf({ ownerRole: 'alumni', gradYear: null }, YEAR, 0)).toBe('alumni');
    expect(standingOf({ ownerRole: 'student', gradYear: YEAR }, YEAR, 0)).toBe('senior');
    expect(standingOf({ ownerRole: 'student', gradYear: YEAR + 2 }, YEAR, 0)).toBeNull();
    expect(standingOf({ ownerRole: 'student', gradYear: YEAR + 1 }, YEAR, 1)).toBe('senior');
  });
});

describe('getLegacy', () => {
  it('opens at unlock.legacy.minProjects and searches by text, expansion topics and filters, never hidden or blocked owners', async () => {
    const viewer = await member();
    const alum = await member(uni, { role: 'alumni', gradYear: YEAR - 2, departmentId: department });
    const senior = await member(uni, { gradYear: YEAR });
    const hidden = await member(uni, { visibility: 'hidden' });
    const blocker = await member();
    const far = await member(otherUni);
    const entries: Record<string, string> = {};
    for (const [person, name, description, topics, stars] of [
      [alum, 'vision-lab', 'Object detection for lab equipment', ['computer-vision'], 40],
      [senior, 'notes-app', 'Shared lecture notes', ['react'], 10],
      [hidden, 'hidden-vision', 'Computer vision secrets', ['computer-vision'], 99],
      [blocker, 'blocked-vision', 'Computer vision too', ['computer-vision'], 99],
      [far, 'far-vision', 'Computer vision elsewhere', ['computer-vision'], 99],
    ] as const) {
      const id = await repo(person, name, { description, topics: [...topics], stars });
      entries[name] = await addLegacyEntry(person, { repoGithubId: id, blurb: '', acceptsQuestions: true });
      await database.sql`update legacy_entries set tags = ${[...topics]} where id = ${entries[name]}`;
    }
    await database.sql`insert into blocks (blocker, blocked) values (${blocker.id}, ${viewer.id})`;

    await withSettings({ 'unlock.legacy.minProjects': 10_000 }, async () => {
      expect(await getLegacy(viewer, {})).toMatchObject({ state: 'locked', required: 10_000 });
    });
    // The hidden member's entry does not count toward the unlock; the blocker's does (blocks are personal).
    expect((await campusUnlocks(uni)).unlocks.find((unlock) => unlock.key === 'legacy')?.current).toBe(3);

    const all = await open(() => getLegacy(viewer, { sort: 'stars' }));
    expect(all.state === 'open' ? all.entries.map((entry) => entry.fullName) : null).toEqual([`${alum.login}/vision-lab`, `${senior.login}/notes-app`]);
    expect(all.state === 'open' ? all.entries.map((entry) => entry.standing) : null).toEqual(['alumni', 'senior']);

    // "object detection" is not in the text of notes-app, and its expansion brings in computer-vision.
    await database.sql`
      insert into taxonomy_expansions (term, slug, items, sample_size, computed_at, expires_at)
      values ('image recognition', 'image-recognition', ${database.sql.json([{ kind: 'topic', value: 'computer-vision', score: 1, source: 'cooccurrence' }])}, 10, now(), now() + interval '1 day')`;
    const searched = await open(() => getLegacy(viewer, { q: 'image recognition' }));
    expect(searched.state === 'open' ? [searched.entries.map((entry) => entry.fullName), searched.expanded] : null).toEqual([[`${alum.login}/vision-lab`], ['computer-vision']]);
    const text = await open(() => getLegacy(viewer, { q: 'lecture notes' }));
    expect(text.state === 'open' ? text.entries.map((entry) => entry.fullName) : null).toEqual([`${senior.login}/notes-app`]);
    const filtered = await open(() => getLegacy(viewer, { department, from: YEAR - 3, to: YEAR - 1, tag: 'Computer-Vision' }));
    expect(filtered.state === 'open' ? filtered.entries.map((entry) => entry.fullName) : null).toEqual([`${alum.login}/vision-lab`]);
    // An uncached query is expanded later; the search still runs on its words.
    const queued = await open(() => getLegacy(viewer, { q: 'equipment' }));
    expect(queued.state === 'open' ? queued.entries.map((entry) => entry.fullName) : null).toEqual([`${alum.login}/vision-lab`]);
    expect(await database.sql`select 1 from jobs where type = 'taxonomy_expand' and payload->>'term' = 'equipment'`).toHaveLength(1);
  });
});

describe('detail and questions', () => {
  it('shows the README as a plain-text excerpt and lets members ask an author who takes questions', async () => {
    const viewer = await member();
    const author = await member(uni, { gradYear: YEAR });
    const quiet = await member();
    const outsider = await member(otherUni);
    const repoId = await repo(author, 'parser');
    const entryId = await addLegacyEntry(author, { repoGithubId: repoId, blurb: 'A parser.', acceptsQuestions: true });
    const quietId = await addLegacyEntry(quiet, { repoGithubId: await repo(quiet, 'silent'), blurb: '', acceptsQuestions: false });
    server.use(
      http.get(`${API}/repos/${author.login}/parser/readme`, () =>
        new HttpResponse('# Parser\n\nA **fast** parser. See [docs](https://x.y).\n\n<script>alert(1)</script>', { headers: { ...headers(), 'content-type': 'text/plain' } }),
      ),
    );
    const detail = await getLegacyDetail(viewer, { entryId });
    expect(detail).toMatchObject({ excerpt: 'Parser\n\nA fast parser. See docs.\n\nalert(1)', standing: 'senior', canAsk: true });
    expect(await getLegacyDetail(outsider, { entryId })).toBeNull();

    const requestId = await askLegacyAuthor(viewer, { entryId, message: 'Hi! How did you handle operator precedence in your parser? I am stuck on mine.' });
    expect((await database.sql`select context_kind, context_id, to_user from message_requests where id = ${requestId}`)[0]).toEqual({
      context_kind: 'legacy',
      context_id: entryId,
      to_user: author.id,
    });
    await expect(askLegacyAuthor(viewer, { entryId: quietId, message: 'Hi! Could you tell me about this project and how you built it?' })).rejects.toMatchObject({
      code: 'legacy.no_questions',
    });
  });
});

describe('legacy_refresh', () => {
  it('refreshes metadata and tags, and removes entries whose repository is gone or no longer the owner’s', async () => {
    const owner = await member();
    const kept = await repo(owner, 'kept', { stars: 1 });
    const gone = await repo(owner, 'gone');
    const moved = await repo(owner, 'moved');
    const [keptId, goneId, movedId] = [
      await addLegacyEntry(owner, { repoGithubId: kept, blurb: '', acceptsQuestions: true }),
      await addLegacyEntry(owner, { repoGithubId: gone, blurb: '', acceptsQuestions: true }),
      await addLegacyEntry(owner, { repoGithubId: moved, blurb: '', acceptsQuestions: true }),
    ];
    const body = (id: number, ownerId: number, name: string) => ({
      id,
      full_name: `${owner.login}/${name}`,
      private: false,
      fork: false,
      size: 1,
      default_branch: 'main',
      owner: { id: ownerId },
      description: 'Now with a description',
      topics: ['go'],
      stargazers_count: 12,
      forks_count: 2,
      language: 'Go',
    });
    server.use(
      http.get(`${API}/repositories/:id`, ({ params }) => {
        const id = Number(params.id);
        if (id === gone) return HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: headers() });
        if (id === moved) return HttpResponse.json(body(id, 999, 'moved'), { headers: headers() });
        if (id === kept) return HttpResponse.json(body(id, owner.githubId, 'kept'), { headers: headers() });
        return HttpResponse.json(body(id, -1, 'other'), { headers: headers() });
      }),
    );
    await database.sql`delete from legacy_entries where id not in (${keptId}, ${goneId}, ${movedId})`;
    await database.sql`update job_schedules set next_run_at = now() - interval '1 minute', enabled = (name = 'legacy-refresh')`;
    await runTick({ budgetMs: 20_000 });
    expect((await database.sql`select id from legacy_entries`).map((row) => row.id)).toEqual([keptId]);
    expect((await database.sql`select stars, description from gh_repos where github_id = ${kept}`)[0]).toEqual({ stars: 12, description: 'Now with a description' });
    expect((await database.sql`select tags from legacy_entries where id = ${keptId}`)[0]?.tags).toEqual(['go']);
  });
});
