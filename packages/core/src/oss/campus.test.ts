import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { askOssContributor, ossCampus, refreshMemberContribs } from './campus';

const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;
let uni: string;
let otherUni: string;
let counter = 0;

const reset = () => Math.floor(Date.now() / 1000) + 3600;
const searchHeaders = () => ({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '29', 'x-ratelimit-reset': String(reset()), 'x-ratelimit-resource': 'search' });
const MESSAGE = 'Hi! I see you had pull requests merged into this project. How did you find your first issue there?';

type Person = { id: string; login: string; verified: boolean; universityId: string | null };

async function member(universityId: string | null, options: { verified?: boolean; ghost?: boolean } = {}): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `contrib-${counter}`;
  const verified = options.verified ?? true;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, ghost_mode)
                     values (${id}, 'UTC', ${universityId}, ${verified ? new Date() : null}, ${options.ghost ?? false})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${220_000 + counter}, ${login})`;
  return { id, login, verified, universityId };
}

const pull = (repo: string, number: number, mergedAt: string) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/${repo}/pull/${number}`,
  repository_url: `${API}/repos/${repo}`,
  comments: 0,
  created_at: mergedAt,
  closed_at: mergedAt,
  pull_request: { merged_at: mergedAt },
});

const contribution = (userId: string, repo: string, merged: number) =>
  database.sql`insert into oss_member_contribs (user_id, repo_full_name, merged_prs, refreshed_at) values (${userId}, ${repo}, ${merged}, now())`;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('OSS Uni', 'oss-uni', 'Testland', 'TL', '{}', 'admin', 'o'), ('Far Uni', 'far-oss-uni', 'Testland', 'TL', '{}', 'admin', 'f') returning id`;
  uni = rows[0]!.id;
  otherUni = rows[1]!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(() => {
  resetGitHubClientState();
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: reset() }, search: { limit: 30, remaining: 29, reset: reset() } } }),
    ),
  );
});

describe('refreshMemberContribs', () => {
  it('counts merged pull requests per project from a paced search, leaving out the member’s own repositories', async () => {
    const someone = await member(uni);
    const queries: string[] = [];
    server.use(
      http.get(`${API}/search/issues`, ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json(
          {
            total_count: 4,
            items: [
              pull('vercel/next.js', 1, '2026-09-01T00:00:00Z'),
              pull('vercel/next.js', 2, '2026-10-01T00:00:00Z'),
              pull('rust-lang/rust', 3, '2026-08-01T00:00:00Z'),
              pull(`${someone.login}/dotfiles`, 4, '2026-10-02T00:00:00Z'),
            ],
          },
          { headers: searchHeaders() },
        );
      }),
    );
    expect(await refreshMemberContribs(someone.id, new Date(), Date.now() + 30_000)).toBe(2);
    expect(queries).toEqual([`is:pr is:merged author:${someone.login}`]);
    const rows = await database.sql<{ repo_full_name: string; merged_prs: number; last_merged_at: Date }[]>`
      select repo_full_name, merged_prs, last_merged_at from oss_member_contribs where user_id = ${someone.id} order by repo_full_name`;
    expect(rows.map((row) => [row.repo_full_name, row.merged_prs, row.last_merged_at.toISOString()])).toEqual([
      ['rust-lang/rust', 1, '2026-08-01T00:00:00.000Z'],
      ['vercel/next.js', 2, '2026-10-01T00:00:00.000Z'],
    ]);

    // A later refresh replaces the rows.
    server.use(http.get(`${API}/search/issues`, () => HttpResponse.json({ total_count: 0, items: [] }, { headers: searchHeaders() })));
    expect(await refreshMemberContribs(someone.id, new Date(), Date.now() + 30_000)).toBe(0);
    expect(await database.sql`select 1 from oss_member_contribs where user_id = ${someone.id}`).toEqual([]);
  });
});

describe('ossCampus', () => {
  it('lists only verified, visible members of the viewer’s university, most merged first', async () => {
    const viewer = await member(uni);
    const [busy, light, ghost, unverified, far, blocker] = [
      await member(uni),
      await member(uni),
      await member(uni, { ghost: true }),
      await member(uni, { verified: false }),
      await member(otherUni),
      await member(uni),
    ];
    for (const [person, merged] of [
      [busy, 5],
      [light, 1],
      [ghost, 9],
      [unverified, 9],
      [far, 9],
      [blocker, 9],
      [viewer, 9],
    ] as const) {
      await contribution(person.id, 'Owner/Project', merged);
    }
    await database.sql`insert into blocks (blocker, blocked) values (${blocker.id}, ${viewer.id})`;
    const result = await ossCampus(viewer, { repos: ['owner/project', 'nobody/else'] });
    expect(result).toEqual({
      state: 'open',
      contributors: {
        'owner/project': [
          { userId: busy.id, login: busy.login, mergedPrs: 5 },
          { userId: light.id, login: light.login, mergedPrs: 1 },
        ],
        'nobody/else': [],
      },
    });
    expect(await ossCampus({ id: viewer.id, verified: false, universityId: null }, { repos: ['owner/project'] })).toEqual({ state: 'unverified' });
  });

  it('asks a listed contributor through a message request with the project as context, and nobody else', async () => {
    const viewer = await member(uni);
    const helper = await member(uni);
    const stranger = await member(uni);
    await contribution(helper.id, 'acme/widget', 2);
    const requestId = await askOssContributor(viewer, { toUserId: helper.id, repo: 'acme/widget', message: MESSAGE });
    expect((await database.sql`select context_kind, context_id from message_requests where id = ${requestId}`)[0]).toEqual({ context_kind: 'oss', context_id: 'acme/widget' });
    await expect(askOssContributor(viewer, { toUserId: stranger.id, repo: 'acme/widget', message: MESSAGE })).rejects.toMatchObject({ code: 'oss.not_a_contributor' });
  });
});
