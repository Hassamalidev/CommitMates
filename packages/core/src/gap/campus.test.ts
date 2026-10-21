import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { askGapHelper, gapHelpers } from './campus';

let database: TestDatabase;
let uni: string;
let counter = 0;

type Person = { id: string; login: string; verified: boolean; universityId: string };

async function member(vector: Record<string, number>, profile: { ghost?: boolean; visibility?: string; universityId?: string } = {}): Promise<Person> {
  counter += 1;
  const id = await insertTestUser(database.sql);
  const login = `helper-${counter}`;
  const universityId = profile.universityId ?? uni;
  await database.sql`update users set created_at = now() - interval '30 days' where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at, ghost_mode, visibility)
                     values (${id}, 'UTC', ${universityId}, now(), ${profile.ghost ?? false}, ${profile.visibility ?? 'university'})`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${330_000 + counter}, ${login})`;
  await database.sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                     values (${id}, '{}', ${database.sql.json(vector)}, ${Object.keys(vector)}, '{}', now())`;
  return { id, login, verified: true, universityId };
}

const open = <T,>(run: () => Promise<T>) => withSettings({ 'unlock.gapCampus.minMembers': 1 }, run);
const MESSAGE = 'Hi! Gap Finder says my project is missing docker, and you know it well. Could you point me in the right direction?';

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Gap Uni', 'gap-uni', 'Testland', 'TL', '{}', 'admin', 'g') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('gapHelpers', () => {
  it('lists members whose level in the gap’s tag reaches swap.minTeachLevel, best first, never hidden, ghosted or blocked ones', async () => {
    const viewer = await member({ react: 0.9 });
    const strong = await member({ docker: 0.9 });
    const fair = await member({ docker: 0.4 });
    const ghost = await member({ docker: 0.95 }, { ghost: true });
    const hidden = await member({ docker: 0.97 }, { visibility: 'hidden' });
    const blocker = await member({ docker: 0.99 });
    // Levels rank everyone here, hidden members included; most members don't use docker at all.
    for (let index = 0; index < 5; index += 1) await member({ sql: 0.5 });
    await database.sql`insert into blocks (blocker, blocked) values (${blocker.id}, ${viewer.id})`;

    const result = await open(() => gapHelpers(viewer, { tags: ['Docker', 'kubernetes', 'docker'] }));
    expect(result.state).toBe('open');
    if (result.state !== 'open') return;
    expect(result.helpers.docker?.map((helper) => helper.login)).toEqual([strong.login, fair.login]);
    // Keyed as asked for, matched in the vocabulary's spelling.
    expect(result.helpers.Docker).toEqual(result.helpers.docker);
    expect(result.helpers.kubernetes).toEqual([]);
    for (const left of [viewer, ghost, hidden, blocker]) expect(result.helpers.docker?.some((helper) => helper.userId === left.id)).toBe(false);
    await withSettings({ 'unlock.gapCampus.minMembers': 1, 'gap.helpersPerGap': 1 }, async () => {
      const one = await gapHelpers(viewer, { tags: ['docker'] });
      expect(one.state === 'open' ? one.helpers.docker?.map((helper) => helper.userId) : null).toEqual([strong.id]);
    });
  });

  it('is locked below unlock.gapCampus.minMembers and needs a verified member', async () => {
    const viewer = await member({});
    expect(await withSettings({ 'unlock.gapCampus.minMembers': 10_000 }, () => gapHelpers(viewer, { tags: ['docker'] }))).toMatchObject({ state: 'locked', required: 10_000 });
    expect(await gapHelpers({ id: viewer.id, verified: false, universityId: null }, { tags: ['docker'] })).toEqual({ state: 'unverified' });
  });
});

describe('askGapHelper', () => {
  it('sends a message request with the gap context to a listed helper, and refuses anyone else', async () => {
    const viewer = await member({});
    const helper = await member({ docker: 0.9 });
    const notHelper = await member({ go: 0.9 });
    const requestId = await open(() => askGapHelper(viewer, { toUserId: helper.id, repoFullName: 'https://github.com/someone/app', tag: 'docker', message: MESSAGE }));
    const [row] = await database.sql`select context_kind, context_id, to_user from message_requests where id = ${requestId}`;
    expect(row).toEqual({ context_kind: 'gap', context_id: 'someone/app', to_user: helper.id });
    await expect(open(() => askGapHelper(viewer, { toUserId: notHelper.id, repoFullName: 'someone/app', tag: 'docker', message: MESSAGE }))).rejects.toMatchObject({
      code: 'gap.not_a_helper',
    });
    await expect(open(() => askGapHelper(viewer, { toUserId: helper.id, repoFullName: 'not a repo', tag: 'docker', message: MESSAGE }))).rejects.toMatchObject({
      code: 'gap.repo_invalid',
    });
  });
});
