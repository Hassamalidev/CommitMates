import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertTestUser, useTestDatabase, type TestDatabase } from '../testing';

/** Crowd tables the browser never reads (CLAUDE.md §5.9): all access goes through the server. */
const SERVER_ONLY = [
  'crawl_cursors',
  'crawl_optouts',
  'leaderboard_snapshots',
  'leaderboard_optins',
  'alumni_questions',
  'question_routes',
  'events',
  'event_participants',
  'squads',
  'squad_members',
  'squad_swap_requests',
  'fyp_ideas',
  'fyp_projects',
  'fyp_supervisors',
  'fyp_interest',
];

let database: TestDatabase;
let member: string;
let university: string;

beforeAll(async () => {
  database = await useTestDatabase();
  member = await insertTestUser(database.sql);
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Crowd Uni', 'crowd-uni', 'Testland', 'TL', '{}', 'admin', 'c') returning id`;
  university = row!.id;
});
afterAll(async () => {
  await database.destroy();
});

describe('crowd tables', () => {
  it('are closed to the browser roles', async () => {
    for (const table of SERVER_ONLY) {
      for (const role of ['anon', 'authenticated'] as const) {
        const rows: unknown[] = await database.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select set_config('request.jwt.claim.sub', ${member}, true)`;
          return [...(await tx.unsafe(`select * from ${table}`))];
        });
        expect(rows, `${role} reading ${table}`).toEqual([]);
      }
    }
  });

  it('keeps one crawl cursor per slice and one leaderboard row per scope and week', async () => {
    await database.sql`insert into crawl_cursors (seed, country_code, created_from, created_to) values ('Lahore', 'PK', '2008-01-01', '2026-01-01')`;
    await expect(database.sql`insert into crawl_cursors (seed, country_code, created_from, created_to) values ('Lahore', 'PK', '2008-01-01', '2026-01-01')`).rejects.toThrow(
      /duplicate key/,
    );
    await database.sql`insert into leaderboard_snapshots (scope, scope_id, group_id, week_start, metrics, score, rank)
                       values ('university', ${university}, 'TL', '2026-10-19', '{}', 0.5, 1)`;
    await expect(
      database.sql`insert into leaderboard_snapshots (scope, scope_id, group_id, week_start, metrics, score, rank)
                   values ('university', ${university}, 'TL', '2026-10-19', '{}', 0.4, 2)`,
    ).rejects.toThrow(/duplicate key/);
  });

  it('indexes FYP ideas for full-text search, keyphrases included', async () => {
    await database.sql`insert into fyp_ideas (university_id, author_user_id, title, description, keyphrases)
                       values (${university}, ${member}, 'Campus parking finder', 'Find free spots with cameras.', '{computer vision}')`;
    const found = await database.sql`select title from fyp_ideas where search_tsv @@ websearch_to_tsquery('simple', 'vision cameras')`;
    expect(found).toEqual([{ title: 'Campus parking finder' }]);
  });

  it('removes a member’s crowd rows with their account, and keeps projects others submitted', async () => {
    const leaving = await insertTestUser(database.sql);
    const other = await insertTestUser(database.sql);
    const [event] = await database.sql<{ id: string }[]>`
      insert into events (creator_user_id, title, university_id, starts_at, ends_at, team_size)
      values (${other}, 'Hack night', ${university}, now(), now() + interval '1 day', 4) returning id`;
    await database.sql`insert into event_participants (event_id, user_id) values (${event!.id}, ${leaving})`;
    const [question] = await database.sql<{ id: string }[]>`
      insert into alumni_questions (asker_user_id, university_id, body, tags) values (${leaving}, ${university}, 'How did you prepare for interviews?', '{}') returning id`;
    await database.sql`insert into question_routes (question_id, alumni_user_id, round) values (${question!.id}, ${other}, 1)`;
    await database.sql`insert into leaderboard_optins (user_id) values (${leaving})`;
    await database.sql`insert into fyp_projects (university_id, repo_github_id, submitted_by, confirmed) values (${university}, 77, ${leaving}, true)`;
    await database.sql`delete from auth.users where id = ${leaving}`;
    expect(await database.sql`select 1 from event_participants where user_id = ${leaving}`).toHaveLength(0);
    expect(await database.sql`select 1 from alumni_questions where id = ${question!.id}`).toHaveLength(0);
    expect(await database.sql`select 1 from question_routes where question_id = ${question!.id}`).toHaveLength(0);
    expect(await database.sql`select 1 from leaderboard_optins where user_id = ${leaving}`).toHaveLength(0);
    expect(await database.sql`select submitted_by from fyp_projects where repo_github_id = 77`).toEqual([{ submitted_by: null }]);
    expect(await database.sql`select 1 from events where id = ${event!.id}`).toHaveLength(1);
  });
});
