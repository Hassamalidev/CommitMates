import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Member } from '../profiles/schemas';

import { answerSuggestion, developersLikeYou, getDiscover, parseDiscoverQuery, requestFromSuggestion } from './discover';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let department: string;
let counter = 0;

const NOW = new Date();
const DAY = NOW.toISOString().slice(0, 10);
const MESSAGE = 'Hi! Your Docker work looks great. Would you like to build something together this term?';
const noFilters = { mode: null } as const;
const render = (icebreaker: { key: string; value: string }) => `Hello! Opener ${icebreaker.key} about ${icebreaker.value}.`;

type Person = Pick<Member, 'id' | 'universityId' | 'verified' | 'hasValidToken'> & { login: string; githubId: number };
type Options = { tags?: string[]; gradYear?: number; department?: string | null; goals?: string[] };

async function member(options: Options = {}): Promise<Person> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `disc-${n}`;
  const githubId = 400_000 + n;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, grad_year, department_id, learning_goals)
                     values (${id}, 'UTC', ${uni}, ${NOW}, ${options.gradYear ?? null}, ${options.department ?? null}, ${options.goals ?? []})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${githubId}, ${login})`;
  const tags = options.tags ?? ['react'];
  const vector = Object.fromEntries(tags.map((tag) => [tag, 1]));
  await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                     values (${id}, ${database.sql.json(vector)}, ${database.sql.json(vector)}, ${tags}, '{}', now())`;
  return { id, login, githubId, universityId: uni, verified: true, hasValidToken: false };
}

async function suggest(user: Person, candidate: Person, mode = 'study', score = 0.5): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into match_suggestions (user_id, candidate_user_id, mode, score, components, explanation_keys, shown_on)
    values (${user.id}, ${candidate.id}, ${mode}, ${score}, '{}', ${database.sql.json({ sharedTags: ['react'], coverage: ['docker'], sharedInterests: 2 })}, ${DAY})
    returning id`;
  return row!.id;
}

const hours = (active: number[]) => Array.from({ length: 24 }, (_, hour) => (active.includes(hour) ? 1 / active.length : 0));

async function snapshot(person: Person, active: number[], labels: string[] = []) {
  await database.sql`insert into persona_snapshots (user_id, metrics, labels, companion, computed_at)
                     values (${person.id}, ${database.sql.json({ hourHistUtc: hours(active) })}, ${labels},
                             ${database.sql.json({ seed: 7, speciesKey: 'docker', paletteHex: '#384d54', stage: 2, traits: [] })}, now())`;
}

async function open<T>(run: () => Promise<T>): Promise<T> {
  return withSettings({ 'unlock.matching.minMembers': 1 }, run);
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
  const [dept] = await database.sql<{ id: string }[]>`
    insert into departments (university_id, name, normalized_name) values (${uni}, 'Computing', 'computing') returning id`;
  department = dept!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
});

describe('parseDiscoverQuery', () => {
  it('reads each parameter on its own and drops bad values', () => {
    expect(parseDiscoverQuery({ mode: 'teammate', department: department, from: '2025', to: 'soon', tag: ' Docker ' })).toEqual({
      mode: 'teammate',
      departmentId: department,
      yearFrom: 2025,
      yearTo: undefined,
      tag: 'docker',
    });
    expect(parseDiscoverQuery({ mode: 'party', department: 'x', from: ['2025', '2026'] })).toMatchObject({ mode: null, departmentId: undefined, yearFrom: undefined });
  });
});

describe('getDiscover', () => {
  it('shows the Unlock card until the university has enough verified members', async () => {
    const me = await member();
    await withSettings({ 'unlock.matching.minMembers': 1000 }, async () => {
      const view = await getDiscover(me, noFilters, NOW);
      expect(view).toMatchObject({ status: 'locked', unlock: { key: 'matching', required: 1000 } });
    });
  });

  it('lists the mode’s deck best first with snapshot companions, labels, reasons and shared hours', async () => {
    const me = await member({ goals: ['docker'] });
    const [best, other, teammate] = [await member({ tags: ['docker', 'react'] }), await member(), await member()];
    await snapshot(me, [20, 21, 22]);
    await snapshot(best, [21, 22, 23], ['night-owl']);
    await suggest(me, other, 'study', 0.4);
    await suggest(me, best, 'study', 0.9);
    await suggest(me, teammate, 'teammate', 0.7);

    const view = await open(() => getDiscover(me, noFilters, NOW));
    if (view.status !== 'open') throw new Error('expected an open deck');
    expect(view).toMatchObject({ mode: 'study', emptyProfile: false, hasGoals: true, hasDeck: true });
    expect(view.cards.map((card) => card.login)).toEqual([best.login, other.login]);
    expect(view.cards[0]).toMatchObject({
      labels: ['night-owl'],
      companion: { seed: 7, speciesKey: 'docker', stage: 2 },
      why: { sharedTags: ['react'], coverage: ['docker'], sharedInterests: 2, window: { startHourUtc: 21, hours: 2 } },
    });
    // Without a snapshot the companion starts from the GitHub id and top tag, and no hours are compared.
    expect(view.cards[1]).toMatchObject({ labels: [], companion: { seed: other.githubId, speciesKey: 'react', stage: 0 }, why: { window: null } });

    const teammates = await open(() => getDiscover(me, { mode: 'teammate' }, NOW));
    expect(teammates.status === 'open' && teammates.cards.map((card) => card.login)).toEqual([teammate.login]);
  });

  it('filters by department, graduation years and tag, and offers the deck’s tags', async () => {
    const me = await member();
    const [inDept, graduate, tagged] = [
      await member({ department, gradYear: 2027 }),
      await member({ gradYear: 2024 }),
      await member({ tags: ['rust'], gradYear: 2026 }),
    ];
    for (const candidate of [inDept, graduate, tagged]) await suggest(me, candidate);
    const logins = async (query: Parameters<typeof getDiscover>[1]) => {
      const view = await open(() => getDiscover(me, query, NOW));
      return view.status === 'open' ? view.cards.map((card) => card.login).sort() : [];
    };
    expect(await logins({ mode: null, departmentId: department })).toEqual([inDept.login]);
    expect(await logins({ mode: null, yearFrom: 2025, yearTo: 2026 })).toEqual([tagged.login]);
    expect(await logins({ mode: null, tag: 'rust' })).toEqual([tagged.login]);
    const view = await open(() => getDiscover(me, noFilters, NOW));
    expect(view.status === 'open' && view.options.tags).toEqual(['react', 'rust']);
    expect(view.status === 'open' && view.options.departments).toEqual([{ id: department, name: 'Computing' }]);
  });

  it('hides people blocked since the deck was built, or who went ghost, hidden or inactive', async () => {
    const me = await member();
    const [blocked, ghost, hidden, suspended, visible] = await Promise.all(Array.from({ length: 5 }, () => member()));
    for (const candidate of [blocked!, ghost!, hidden!, suspended!, visible!]) await suggest(me, candidate);
    await database.sql`insert into blocks (blocker, blocked) values (${blocked!.id}, ${me.id})`;
    await database.sql`update profiles set ghost_mode = true where user_id = ${ghost!.id}`;
    await database.sql`update profiles set visibility = 'hidden' where user_id = ${hidden!.id}`;
    await database.sql`update users set status = 'suspended' where id = ${suspended!.id}`;
    const view = await open(() => getDiscover(me, noFilters, NOW));
    expect(view.status === 'open' && view.cards.map((card) => card.login)).toEqual([visible!.login]);
  });

  it('starts members without skill tags in Explore and says when no deck was built', async () => {
    const empty = await member({ tags: [] });
    const view = await open(() => getDiscover(empty, noFilters, NOW));
    expect(view).toMatchObject({ status: 'open', mode: 'explore', emptyProfile: true, hasGoals: false, hasDeck: false, cards: [] });
  });
});

describe('deck actions', () => {
  it('records Like and Skip once, only on the member’s own suggestions, and keeps likes for a request', async () => {
    const [me, someone, other] = [await member(), await member(), await member()];
    const liked = await suggest(me, someone);
    const skipped = await suggest(me, other);
    const theirs = await suggest(other, me);

    await answerSuggestion(me, 'liked', { suggestionId: liked }, NOW);
    await answerSuggestion(me, 'skipped', { suggestionId: skipped }, NOW);
    await expect(answerSuggestion(me, 'liked', { suggestionId: liked }, NOW)).rejects.toMatchObject({ code: 'discover.gone' });
    await expect(answerSuggestion(me, 'skipped', { suggestionId: theirs }, NOW)).rejects.toMatchObject({ code: 'discover.gone' });

    const view = await open(() => getDiscover(me, noFilters, NOW));
    if (view.status !== 'open') throw new Error('expected an open deck');
    expect(view.cards).toEqual([]);
    expect(view.liked.map((card) => card.login)).toEqual([someone.login]);

    // A liked person can still be sent a request; the card then leaves the liked list.
    await requestFromSuggestion(me, { suggestionId: liked, message: MESSAGE }, render, NOW);
    const after = await open(() => getDiscover(me, noFilters, NOW));
    expect(after.status === 'open' && after.liked).toEqual([]);
    await expect(requestFromSuggestion(me, { suggestionId: skipped, message: MESSAGE }, render, NOW)).rejects.toMatchObject({ code: 'discover.gone' });
  });

  it('sends a request with Discover as its context, and leaves the card untouched when the request is refused', async () => {
    const [me, someone] = [await member(), await member()];
    const suggestionId = await suggest(me, someone);
    await expect(requestFromSuggestion(me, { suggestionId, message: 'hi' }, render, NOW)).rejects.toMatchObject({ code: 'chat.first_message_short' });
    const [untouched] = await database.sql`select action from match_suggestions where id = ${suggestionId}`;
    expect(untouched?.action).toBeNull();

    const requestId = await requestFromSuggestion(me, { suggestionId, message: MESSAGE }, render, NOW);
    const [row] = await database.sql`select to_user, context_kind, context_id from message_requests where id = ${requestId}`;
    expect(row).toMatchObject({ to_user: someone.id, context_kind: 'discover', context_id: suggestionId });
    const [marked] = await database.sql`select action from match_suggestions where id = ${suggestionId}`;
    expect(marked?.action).toBe('requested');
  });
});

describe('icebreakers', () => {
  it('offers openers from the suggestion’s signals and only sends those', async () => {
    const me = await member({ goals: ['docker'] });
    const someone = await member({ tags: ['docker', 'react'] });
    const suggestionId = await suggest(me, someone);
    const view = await open(() => getDiscover(me, noFilters, NOW));
    expect(view.status === 'open' && view.cards[0]?.icebreakers).toEqual([
      { key: 'sharedTag', value: 'react' },
      { key: 'learning', value: 'docker' },
      { key: 'interests', value: '2' },
    ]);

    await expect(requestFromSuggestion(me, { suggestionId, message: '', icebreaker: 'sharedTag:rust' }, render, NOW)).rejects.toMatchObject({
      code: 'chat.icebreaker_unknown',
    });
    await expect(requestFromSuggestion(me, { suggestionId, message: '', icebreaker: 'made-up' }, render, NOW)).rejects.toMatchObject({
      code: 'chat.icebreaker_unknown',
    });
    // An opener is short, and that is fine: the template says why.
    const requestId = await requestFromSuggestion(me, { suggestionId, message: 'ignored', icebreaker: 'learning:docker' }, render, NOW);
    const [row] = await database.sql`select icebreaker_key, first_message from message_requests where id = ${requestId}`;
    expect(row).toMatchObject({ icebreaker_key: 'learning:docker', first_message: 'Hello! Opener learning about docker.' });
  });

  it('offers the learning opener only for real goals', async () => {
    const me = await member();
    const someone = await member({ tags: ['docker'] });
    await suggest(me, someone);
    const view = await open(() => getDiscover(me, noFilters, NOW));
    expect(view.status === 'open' && view.cards[0]?.icebreakers.map((icebreaker) => icebreaker.key)).toEqual(['sharedTag', 'interests']);
  });
});

describe('developersLikeYou', () => {
  const reset = () => Math.floor(Date.now() / 1000) + 3600;
  const searchHeaders = () => ({ 'x-ratelimit-limit': '60000', 'x-ratelimit-remaining': '59000', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'search' });

  it('needs a language from the member’s own repositories', async () => {
    expect(await developersLikeYou(await member(), NOW)).toEqual({ status: 'no-language' });
  });

  it('searches GitHub by language and country, leaves the member out, and caches the list', async () => {
    const me = await member();
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, primary_language, is_fork, fetched_at)
                       values (900001, ${me.githubId}, ${`${me.login}/a`}, 'a', 'Go', false, now()),
                              (900002, ${me.githubId}, ${`${me.login}/b`}, 'b', 'Go', false, now()),
                              (900003, ${me.githubId}, ${`${me.login}/c`}, 'c', 'Rust', false, now()),
                              (900004, ${me.githubId}, ${`${me.login}/d`}, 'd', 'Rust', true, now())`;
    const queries: string[] = [];
    const person = (id: number, login: string, type = 'User') => ({ id, login, avatar_url: `https://avatars.githubusercontent.com/u/${id}`, html_url: `https://github.com/${login}`, type });
    server.use(
      http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } })),
      http.get(`${API}/search/users`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json(
          { total_count: 3, incomplete_results: false, items: [person(me.githubId, me.login), person(1, 'gopher'), person(2, 'some-org', 'Organization'), person(3, 'tester')] },
          { headers: searchHeaders() },
        );
      }),
    );
    const first = await withSettings({ 'matching.coldStartListSize': 1 }, () => developersLikeYou(me, NOW));
    expect(first).toEqual({
      status: 'ok',
      language: 'Go',
      country: 'Testland',
      people: [{ githubId: 1, login: 'gopher', avatarUrl: 'https://avatars.githubusercontent.com/u/1', htmlUrl: 'https://github.com/gopher' }],
    });
    expect(queries).toEqual(['language:"Go" location:"Testland" type:user']);

    // Served from the cache, filed under the member's login and expiring like other non-member data.
    expect(await developersLikeYou(me, NOW)).toEqual(first);
    expect(queries).toHaveLength(1);
    const [cached] = await database.sql<{ subject_key: string; is_member_subject: boolean; expires_at: Date }[]>`
      select subject_key, is_member_subject, expires_at from analysis_cache where kind = 'developers_like_you'`;
    expect(cached).toMatchObject({ subject_key: me.login, is_member_subject: false });
    expect(cached!.expires_at.getTime() - NOW.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('says the list is unavailable when GitHub is down', async () => {
    const me = await member();
    await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, primary_language, is_fork, fetched_at)
                       values (900010, ${me.githubId}, ${`${me.login}/a`}, 'a', 'Python', false, now())`;
    server.use(
      http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset: reset() }, search: { limit: 60000, remaining: 59000, reset: reset() } } })),
      http.get(`${API}/search/users`, () => new HttpResponse(null, { status: 502 })),
    );
    expect(await developersLikeYou(me, NOW)).toEqual({ status: 'unavailable' });
  });
});
