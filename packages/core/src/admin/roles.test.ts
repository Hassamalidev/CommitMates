import { writeAudit } from '@commitmates/db';
import { insertTestUser, useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { MemberRole } from '../profiles/schemas';

import { AUDIT_PAGE_SIZE, changeAdmin, listRoles, moderationScope, readAuditLog } from './roles';

let database: TestDatabase;
let uni: string;
let counter = 0;

async function member(roleRows: { role: 'admin' | 'uni_moderator'; universityId?: string }[] = []) {
  counter += 1;
  const login = `roles-${counter}`;
  const id = await insertTestUser(database.sql);
  await database.sql`insert into profiles (user_id, timezone) values (${id}, 'UTC')`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${400_000 + counter}, ${login})`;
  for (const row of roleRows) await database.sql`insert into roles (user_id, role, university_id) values (${id}, ${row.role}, ${row.universityId ?? null})`;
  const roles: MemberRole[] = roleRows.map((row) => ({ role: row.role, universityId: row.universityId ?? null }));
  return { id, login, roles };
}

beforeAll(async () => {
  database = await useTestDatabase();
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni', 'uni-tl', 'Testland', 'TL', '{}', 'admin', 'x') returning id`;
  uni = row!.id;
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(async () => {
  await database.sql`truncate roles, audit_log`;
});

describe('admin roles', () => {
  it('lets admins grant and revoke admins, never themselves and never the last one', async () => {
    const first = await member([{ role: 'admin' }]);
    const second = await member();

    expect(await changeAdmin(first, { login: second.login, grant: true })).toEqual({ changed: true });
    expect(await changeAdmin(first, { login: `@${second.login}`, grant: true })).toEqual({ changed: false });
    await expect(changeAdmin(first, { login: first.login, grant: false })).rejects.toMatchObject({ code: 'roles.self_revoke' });

    const asSecond = { ...second, roles: [{ role: 'admin' as const, universityId: null }] };
    expect(await changeAdmin(asSecond, { login: first.login, grant: false })).toEqual({ changed: true });
    // `second` is now the only admin; another admin cannot exist to remove them, and they cannot remove themselves.
    await expect(changeAdmin(asSecond, { login: second.login, grant: false })).rejects.toMatchObject({ code: 'roles.self_revoke' });

    const grants = await listRoles(asSecond);
    expect(grants.map((grant) => [grant.login, grant.role])).toEqual([[second.login, 'admin']]);
    const audit = await database.sql`select action, data from audit_log order by id`;
    expect(audit).toEqual([
      { action: 'role.grant', data: { role: 'admin' } },
      { action: 'role.revoke', data: { role: 'admin' } },
    ]);
  });

  it('refuses to remove the last admin even when asked by another member with stale rights', async () => {
    const only = await member([{ role: 'admin' }]);
    const stale = await member();
    await expect(changeAdmin({ ...stale, roles: [{ role: 'admin', universityId: null }] }, { login: only.login, grant: false })).rejects.toMatchObject({
      code: 'roles.last_admin',
    });
  });

  it('is closed to moderators and members', async () => {
    const moderator = await member([{ role: 'uni_moderator', universityId: uni }]);
    const plain = await member();
    for (const actor of [moderator, plain]) {
      await expect(listRoles(actor)).rejects.toMatchObject({ code: 'roles.forbidden' });
      await expect(changeAdmin(actor, { login: plain.login, grant: true })).rejects.toMatchObject({ code: 'roles.forbidden' });
      await expect(readAuditLog(actor, {})).rejects.toMatchObject({ code: 'roles.forbidden' });
    }
  });
});

describe('audit log', () => {
  it('pages newest first and filters by action prefix and target type', async () => {
    const admin = await member([{ role: 'admin' }]);
    for (let index = 0; index < AUDIT_PAGE_SIZE + 2; index += 1) {
      await writeAudit({ actorUserId: admin.id, action: index % 2 === 0 ? 'role.grant' : 'schedule.disabled', targetType: index % 2 === 0 ? 'user' : 'schedule', targetId: String(index) });
    }
    const first = await readAuditLog(admin, {});
    expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.entries[0]).toMatchObject({ targetId: String(AUDIT_PAGE_SIZE + 1), actorLogin: admin.login });
    expect(first.next).not.toBeNull();
    const second = await readAuditLog(admin, { before: String(first.next) });
    expect(second.entries.map((entry) => entry.targetId)).toEqual(['1', '0']);
    expect(second.next).toBeNull();

    const roles = await readAuditLog(admin, { action: 'role.' });
    expect(roles.entries.every((entry) => entry.action === 'role.grant')).toBe(true);
    expect((await readAuditLog(admin, { targetType: 'schedule' })).entries.every((entry) => entry.targetType === 'schedule')).toBe(true);
    expect(first.targetTypes).toEqual(['schedule', 'user']);
  });
});

describe('moderationScope', () => {
  it('gives admins everything, moderators their universities, and nobody else anything', async () => {
    const admin = await member([{ role: 'admin' }]);
    const moderator = await member([{ role: 'uni_moderator', universityId: uni }]);
    expect(await moderationScope(admin)).toEqual({ admin: true, universities: [] });
    expect(await moderationScope(moderator)).toMatchObject({ admin: false, universities: [{ id: uni, name: 'Uni' }] });
    await expect(moderationScope(await member())).rejects.toMatchObject({ code: 'moderation.forbidden' });
  });
});
