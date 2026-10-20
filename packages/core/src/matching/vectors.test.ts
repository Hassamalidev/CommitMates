import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { enqueue, runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import type { DevCard } from '../persona/schemas';

import { baseFromCard, interestsOf, recomputeUniversityVectors, requestSkillVector } from './vectors';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let counter = 0;

const aliases = new Map([
  ['reactjs', 'react'],
  ['react', 'react'],
  ['ts', 'typescript'],
]);

function card(login: string, githubId: number, overrides: Partial<DevCard> = {}): DevCard {
  const hist = Array.from({ length: 24 }, () => 0);
  return {
    login,
    name: null,
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}?v=4`,
    githubId,
    isMember: true,
    timezone: 'UTC',
    timezoneSource: 'utc',
    window: { eventsFrom: '2026-07-16T12:00:00.000Z', eventsTo: '2026-10-14T12:00:00.000Z' },
    languages: [{ name: 'TypeScript', share: 0.8, color: '#3178c6' }],
    tags: [{ tag: 'reactjs', weight: 1 }],
    hourHist: hist,
    hourHistUtc: hist,
    topics: ['ReactJS', 'web'],
    metrics: {
      nightShare: 0,
      morningShare: 0,
      weekendShare: 0,
      cv: 0,
      activeDayShare: 0,
      longestStreak: 0,
      total365: 0,
      privateIncluded: false,
      events: 0,
      activeDays90: 0,
    },
    labels: [],
    enoughActivity: true,
    reposTruncated: false,
    reposAnalyzed: 1,
    activityScore: 0,
    companion: { seed: githubId, speciesKey: 'react', paletteHex: '#3178c6', stage: 0, traits: [] },
    calendar90: [],
    ...overrides,
  };
}

/** A verified member with a GitHub login (and no token, so the server identity reads their stars). */
async function member(verified = true): Promise<{ id: string; login: string; githubId: number }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `vec-${n}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${uni}, ${verified ? new Date() : null})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${300_000 + n}, ${login})`;
  return { id, login, githubId: 300_000 + n };
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
  await database.sql`insert into topics (slug, display_name, aliases, related, blob_sha, synced_at) values ('react', 'React', '{reactjs}', '{}', 'a', now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
});

describe('base vectors', () => {
  it('merges language shares and skill tags through aliases, keeping the larger weight', () => {
    expect(baseFromCard({ languages: [{ name: 'TypeScript', share: 0.8, color: null }], tags: [{ tag: 'reactjs', weight: 0.4 }, { tag: 'React', weight: 0.9 }] }, aliases)).toEqual({
      typescript: 0.8,
      react: 0.9,
    });
    expect(interestsOf(['ReactJS', 'web', 'react', ' ts '], aliases)).toEqual(['react', 'typescript', 'web']);
  });
});

describe('recomputeUniversityVectors', () => {
  it('weights the verified members of a university with TF-IDF', async () => {
    await database.sql`truncate skill_vectors`;
    const [a, b, c, outsider] = [await member(), await member(), await member(), await member(false)];
    for (const [who, base] of [
      [a, { react: 1, docker: 0.5 }],
      [b, { react: 0.8, python: 1 }],
      [c, { python: 0.6 }],
      [outsider, { react: 1 }],
    ] as const) {
      await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                         values (${who.id}, ${database.sql.json(base)}, '{}', '{}', '{}', now())`;
    }
    // The unverified member is not part of the university's document frequencies.
    expect(await recomputeUniversityVectors(uni)).toBe(3);
    const [row] = await database.sql<{ vector: Record<string, number>; top_tags: string[] }[]>`select vector, top_tags from skill_vectors where user_id = ${a.id}`;
    expect(row?.vector.react).toBeCloseTo(0.797515, 5);
    expect(row?.vector.docker).toBeCloseTo(0.603293, 5);
    expect(row?.top_tags).toEqual(['react', 'docker']);
  });
});

describe('compute_skill_vector job', () => {
  it('builds a member’s vector from their card and stars, and skips unverified members', async () => {
    const someone = await member();
    await database.sql`insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
                       values ('dev_card', ${someone.login}, 'default', ${database.sql.json(
                         card(someone.login, someone.githubId, {
                           labels: [
                             { key: 'night-owl', strength: 1.2 },
                             { key: 'sprinter', strength: 2 },
                             { key: 'early-bird', strength: 1.1 },
                             { key: 'marathoner', strength: 1.5 },
                           ],
                         }),
                       )}, true, now(), now() + interval '1 hour')`;
    const reset = Math.floor(Date.now() / 1000) + 3600;
    server.use(
      http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset } } })),
      http.get(`${API}/users/:login/starred`, () =>
        HttpResponse.json([{ full_name: 'x/y', topics: ['machine-learning', 'reactjs'] }], {
          headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4980', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' },
        }),
      ),
    );
    const job = await requestSkillVector(someone.id);
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    const [row] = await database.sql`select base, interests, top_tags from skill_vectors where user_id = ${someone.id}`;
    expect(row).toMatchObject({ base: { typescript: 0.8, react: 1 }, interests: ['machine-learning', 'react', 'web'] });
    expect((row?.top_tags as string[]).length).toBeGreaterThan(0);
    // The persona snapshot keeps the three strongest labels, the companion and the UTC hours.
    const [persona] = await database.sql`select labels, companion, metrics, window_start from persona_snapshots where user_id = ${someone.id}`;
    expect(persona).toMatchObject({
      labels: ['sprinter', 'marathoner', 'night-owl'],
      companion: { seed: someone.githubId, speciesKey: 'react' },
      metrics: { hourHistUtc: expect.any(Array), total365: 0 },
      window_start: new Date('2026-07-16T12:00:00.000Z'),
    });

    const unverified = await member(false);
    const skipped = await enqueue('compute_skill_vector', { userId: unverified.id });
    await runTick({ budgetMs: 30_000, onlyJobId: skipped.id });
    expect(await database.sql`select 1 from skill_vectors where user_id = ${unverified.id}`).toHaveLength(0);
  });

  it('is queued once per member and day, and weekly for stale vectors', async () => {
    const someone = await member();
    const first = await requestSkillVector(someone.id, new Date('2026-10-14T08:00:00Z'));
    const again = await requestSkillVector(someone.id, new Date('2026-10-14T20:00:00Z'));
    expect(again.id).toBe(first.id);

    await database.sql`truncate jobs`;
    const refresh = await enqueue('refresh_skill_vectors', {});
    await runTick({ budgetMs: 30_000, onlyJobId: refresh.id });
    const queued = await database.sql<{ payload: { userId: string } }[]>`select payload from jobs where type = 'compute_skill_vector'`;
    expect(queued.map((row) => row.payload.userId)).toContain(someone.id);
  });
});
