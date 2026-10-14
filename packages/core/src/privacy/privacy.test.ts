import { readFileSync } from 'node:fs';

import { hashUserId, setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { setMailTransport } from '@commitmates/email';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { exportMemberData, prepareAccountDeletion, updatePrivacySettings } from './service';

const privacyDoc = readFileSync(new URL('../../../../docs/PRIVACY.md', import.meta.url), 'utf8');
const sendMail = vi.fn((message: { to: string; subject: string }) => Promise.resolve({ messageId: message.to }));
let database: TestDatabase;
let counter = 0;

/** Tables PRIVACY.md lists as class A, or class B for members. */
function documentedMemberTables(): string[] {
  return privacyDoc
    .split('\n')
    .filter((line) => line.startsWith('### ') && /class [AB]\b|class B for members/.test(line))
    .flatMap((line) => [...line.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? ''));
}

/** A member with GitHub data, cached analyses and rows in most class A tables. */
async function richMember() {
  counter += 1;
  const n = counter;
  const login = `privacy-${n}`;
  const githubId = 500_000 + n;
  const id = await insertTestUser(database.sql);
  await database.sql`update auth.users set email = ${`${login}@uni.edu`} where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone) values (${id}, 'UTC')`;
  await database.sql`insert into github_identities (user_id, github_id, login, token_enc) values (${id}, ${githubId}, ${login}, 'v1.secret-ciphertext')`;
  await database.sql`insert into email_verifications (user_id, email, domain, code_hash) values (${id}, ${`${login}@uni.edu`}, 'uni.edu', 'secret-hash')`;
  await database.sql`insert into notifications (user_id, kind) values (${id}, 'verified_by_vouches')`;
  await database.sql`insert into feedback (user_id, page, body) values (${id}, '/home', 'Nice')`;
  await database.sql`insert into gh_users (github_id, login, type, is_member, fetched_at) values (${githubId}, ${login}, 'User', true, now())`;
  await database.sql`insert into gh_repos (github_id, owner_github_id, full_name, name, topics, is_fork, fetched_at)
                     values (${githubId * 10}, ${githubId}, ${`${login}/app`}, 'app', '{}', false, now())`;
  await database.sql`insert into repo_dependencies (repo_github_id, ecosystem, package_name, is_dev) values (${githubId * 10}, 'npm', 'react', false)`;
  for (const subject of [login, `login:${login}`, `${login}:zz-other`, `aa-other:${login}`, `not-${login}`]) {
    await database.sql`insert into analysis_cache (kind, subject_key, params_hash, result, computed_at, expires_at)
                       values ('dev_card', ${subject}, 'default', '{}', now(), now() + interval '1 hour')`;
  }
  return { id, login, githubId };
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  setMailTransport({ sendMail } as never);
});
afterAll(async () => {
  setMailTransport(undefined);
  await database.destroy();
  setLogger(undefined);
});

describe('exportMemberData', () => {
  it('contains every class A and B table PRIVACY.md lists, without secrets', async () => {
    const member = await richMember();
    const exported = await exportMemberData({ id: member.id, login: member.login });
    const tables = documentedMemberTables();
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables) expect(Object.keys(exported.tables), table).toContain(table);

    expect(exported.tables.gh_repos).toHaveLength(1);
    expect(exported.tables.repo_dependencies).toHaveLength(1);
    // Cached analyses about this member, not about someone whose login merely contains it.
    expect(exported.tables.analysis_cache).toHaveLength(4);
    const json = JSON.stringify(exported);
    expect(json).not.toContain('secret-ciphertext');
    expect(json).not.toContain('secret-hash');
  });
});

describe('updatePrivacySettings', () => {
  it('saves visibility and ghost mode', async () => {
    const member = await richMember();
    await updatePrivacySettings(member, { visibility: 'hidden', ghostMode: 'on' });
    expect(await database.sql`select visibility, ghost_mode from profiles where user_id = ${member.id}`).toEqual([{ visibility: 'hidden', ghost_mode: true }]);
    await expect(updatePrivacySettings(member, { visibility: 'everyone', ghostMode: '' })).rejects.toThrow();
  });
});

describe('account deletion', () => {
  it('requires the typed login, then removes everything, leaving only a hashed audit entry', async () => {
    const member = await richMember();
    await expect(prepareAccountDeletion(member, { confirm: 'something else' })).rejects.toMatchObject({ field: 'confirm' });
    expect(sendMail).not.toHaveBeenCalled();

    await prepareAccountDeletion(member, { confirm: `@${member.login.toUpperCase()}` });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: `${member.login}@uni.edu`, subject: 'Your account was deleted' }));
    expect(await database.sql`select 1 from gh_users where github_id = ${member.githubId}`).toHaveLength(0);
    expect(await database.sql`select 1 from repo_dependencies where repo_github_id = ${member.githubId * 10}`).toHaveLength(0);
    expect((await database.sql`select subject_key from analysis_cache`).map((row) => row.subject_key)).toContain(`not-${member.login}`);
    expect(await database.sql`select 1 from analysis_cache where subject_key = ${member.login}`).toHaveLength(0);

    // The auth user goes last (Supabase admin API in the app); every member row cascades with it.
    await database.sql`delete from auth.users where id = ${member.id}`;
    const [left] = await database.sql<Record<string, number>[]>`
      select
        (select count(*) from users where id = ${member.id})::int as users,
        (select count(*) from profiles where user_id = ${member.id})::int as profiles,
        (select count(*) from github_identities where user_id = ${member.id})::int as github_identities,
        (select count(*) from email_verifications where user_id = ${member.id})::int as email_verifications,
        (select count(*) from notifications where user_id = ${member.id})::int as notifications,
        (select count(*) from feedback where user_id = ${member.id})::int as feedback`;
    expect(Object.values(left ?? {}).every((count) => count === 0)).toBe(true);
    const audit = await database.sql`select actor_user_id, action, target_id from audit_log where action = 'account.deleted'`;
    expect(audit).toContainEqual({ actor_user_id: null, action: 'account.deleted', target_id: hashUserId(member.id) });
    expect(JSON.stringify(audit)).not.toContain(member.id);
  });
});
