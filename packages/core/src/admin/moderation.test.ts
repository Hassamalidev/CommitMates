import { setLogger } from '@commitmates/db';
import { insertTestUser, useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';
import type { Member } from '../profiles/schemas';

import { getModerationQueue, moderate, viewReportContext } from './moderation';

let database: TestDatabase;
let uniA: string;
let uniB: string;
let counter = 0;

type Actor = Pick<Member, 'id' | 'roles'>;

async function member(universityId: string, status = 'active'): Promise<{ id: string; login: string }> {
  counter += 1;
  const n = counter;
  const id = await insertTestUser(database.sql);
  const login = `mod-${n}`;
  await database.sql`update users set status = ${status} where id = ${id}`;
  await database.sql`insert into profiles (user_id, timezone, university_id, verified_at) values (${id}, 'UTC', ${universityId}, now())`;
  await database.sql`insert into github_identities (user_id, github_id, login) values (${id}, ${700_000 + n}, ${login})`;
  return { id, login };
}

const admin = (id: string): Actor => ({ id, roles: [{ role: 'admin', universityId: null }] });
const moderatorOf = (id: string, universityId: string): Actor => ({ id, roles: [{ role: 'uni_moderator', universityId }] });

async function reportAbout(target: string, reporter: string, messageId: string | null = null): Promise<string> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into reports (reporter, target_user, target_message, reason) values (${reporter}, ${target}, ${messageId}, 'spam') returning id`;
  return row!.id;
}

const statusOf = async (id: string) =>
  (await database.sql<{ status: string; suspended_until: Date | null }[]>`select status, suspended_until from users where id = ${id}`)[0];
const audits = (action: string, targetId: string) => database.sql`select actor_user_id, data from audit_log where action = ${action} and target_id = ${targetId}`;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
  const rows = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, checksum)
    values ('Uni A', 'uni-a', 'Testland', 'TL', '{}', 'admin', 'a'), ('Uni B', 'uni-b', 'Testland', 'TL', '{}', 'admin', 'b') returning id`;
  uniA = rows[0]!.id;
  uniB = rows[1]!.id;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('moderation queue', () => {
  it('groups open reports by member, scoped to the moderator’s universities', async () => {
    const [atA, atB, reporter, mod] = [await member(uniA), await member(uniB), await member(uniA), await member(uniA)];
    await reportAbout(atA.id, reporter.id);
    await reportAbout(atA.id, mod.id);
    await reportAbout(atB.id, reporter.id);

    const forModerator = await getModerationQueue(moderatorOf(mod.id, uniA));
    expect(forModerator.groups.filter((group) => [atA.id, atB.id].includes(group.targetUserId)).map((group) => [group.login, group.reports.length])).toEqual([
      [atA.login, 2],
    ]);
    const forAdmin = await getModerationQueue(admin(mod.id));
    expect(forAdmin.groups.map((group) => group.targetUserId)).toEqual(expect.arrayContaining([atA.id, atB.id]));
    await expect(getModerationQueue({ id: reporter.id, roles: [] })).rejects.toMatchObject({ code: 'moderation.forbidden' });
  });

  it('shows the reported message with the messages around it, only in scope, and audits each reading', async () => {
    const [target, reporter, mod] = [await member(uniA), await member(uniA), await member(uniA)];
    const [thread] = await database.sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
    await database.sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${target.id}), (${thread!.id}, ${reporter.id})`;
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const [row] = await database.sql<{ id: string }[]>`
        insert into messages (thread_id, author_user_id, body, created_at)
        values (${thread!.id}, ${index % 2 === 0 ? target.id : reporter.id}, ${`message ${index}`}, now() + make_interval(secs => ${index}))
        returning id`;
      ids.push(row!.id);
    }
    const reportId = await reportAbout(target.id, reporter.id, ids[2]);

    const context = await withSettings({ 'safety.contextMessages': 1 }, () => viewReportContext(moderatorOf(mod.id, uniA), { reportId }));
    expect(context.map((message) => message.body)).toEqual(['message 1', 'message 2', 'message 3']);
    expect(context[1]).toMatchObject({ authorLogin: target.login, reported: true });
    expect(context.filter((message) => message.reported)).toHaveLength(1);
    expect(await audits('moderation.context_viewed', reportId)).toEqual([{ actor_user_id: mod.id, data: { messages: 3 } }]);
    await expect(viewReportContext(moderatorOf(mod.id, uniB), { reportId })).rejects.toMatchObject({ code: 'moderation.out_of_scope' });
  });
});

describe('moderation actions', () => {
  it('dismissing restores an account the reports hid, and is audited', async () => {
    const [target, reporter, mod] = [await member(uniA, 'hidden_pending_review'), await member(uniA), await member(uniA)];
    await reportAbout(target.id, reporter.id);
    expect(await moderate(moderatorOf(mod.id, uniA), { targetUserId: target.id, action: 'dismiss', note: 'Not spam.' })).toEqual({ resolved: 1 });
    expect((await statusOf(target.id))?.status).toBe('active');
    expect(await database.sql`select status, resolved_by from reports where target_user = ${target.id}`).toEqual([{ status: 'dismissed', resolved_by: mod.id }]);
    expect(await audits('moderation.dismiss', target.id)).toEqual([
      { actor_user_id: mod.id, data: { resolved: 1, until: null, note: 'Not spam.', previousStatus: 'hidden_pending_review' } },
    ]);
    expect(await database.sql`select kind from notifications where user_id = ${target.id}`).toEqual([{ kind: 'account_restored' }]);
  });

  it('warning tells the member and resolves the reports as actioned', async () => {
    const [target, reporter, mod] = [await member(uniA), await member(uniA), await member(uniA)];
    await reportAbout(target.id, reporter.id);
    await moderate(admin(mod.id), { targetUserId: target.id, action: 'warn', note: 'Please keep it friendly.' });
    expect(await database.sql`select kind, data from notifications where user_id = ${target.id}`).toEqual([
      { kind: 'moderation_warning', data: { note: 'Please keep it friendly.' } },
    ]);
    expect(await database.sql`select status from reports where target_user = ${target.id}`).toEqual([{ status: 'actioned' }]);
    expect(await audits('moderation.warn', target.id)).toHaveLength(1);
  });

  it('suspends for a bounded number of days, bans with no end, and lifts suspensions when they end', async () => {
    const [suspended, banned, mod] = [await member(uniA), await member(uniA), await member(uniA)];
    const actor = moderatorOf(mod.id, uniA);
    const now = new Date();
    await expect(moderate(actor, { targetUserId: suspended.id, action: 'suspend' }, now)).rejects.toMatchObject({ code: 'moderation.days', field: 'days' });
    await expect(moderate(actor, { targetUserId: suspended.id, action: 'suspend', days: 400 }, now)).rejects.toMatchObject({ code: 'moderation.days' });
    await moderate(actor, { targetUserId: suspended.id, action: 'suspend', days: '3' }, now);
    expect(await statusOf(suspended.id)).toEqual({ status: 'suspended', suspended_until: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) });
    await moderate(actor, { targetUserId: banned.id, action: 'ban' }, now);
    expect(await statusOf(banned.id)).toEqual({ status: 'suspended', suspended_until: null });
    expect(await audits('moderation.suspend', suspended.id)).toHaveLength(1);
    expect(await audits('moderation.ban', banned.id)).toHaveLength(1);

    await database.sql`update users set suspended_until = now() - interval '1 minute' where id = ${suspended.id}`;
    const job = await enqueue('lift_suspensions', {});
    await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    expect((await statusOf(suspended.id))?.status).toBe('active');
    expect((await statusOf(banned.id))?.status).toBe('suspended');
    expect(await audits('moderation.suspension_lifted', suspended.id)).toEqual([{ actor_user_id: null, data: {} }]);
  });

  it('keeps moderators within their universities, away from admins and from themselves', async () => {
    const [elsewhere, adminTarget, mod] = [await member(uniB), await member(uniA), await member(uniA)];
    await database.sql`insert into roles (user_id, role) values (${adminTarget.id}, 'admin')`;
    const actor = moderatorOf(mod.id, uniA);
    await expect(moderate(actor, { targetUserId: elsewhere.id, action: 'ban' })).rejects.toMatchObject({ code: 'moderation.out_of_scope' });
    await expect(moderate(actor, { targetUserId: adminTarget.id, action: 'ban' })).rejects.toMatchObject({ code: 'moderation.admin_target' });
    await expect(moderate(actor, { targetUserId: mod.id, action: 'dismiss' })).rejects.toMatchObject({ code: 'moderation.self' });
    expect((await statusOf(elsewhere.id))?.status).toBe('active');
  });
});
