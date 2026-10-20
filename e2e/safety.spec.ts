import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };

/** Verified members who already reported `targetUserId`, inserted straight in the database. */
async function seedReporters(universityId: string, targetUserId: string, count: number): Promise<void> {
  await withAppDatabase(async (sql) => {
    for (let index = 0; index < count; index += 1) {
      const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      if (!auth) throw new Error('auth.users insert returned no row');
      await sql`insert into users (id) values (${auth.id}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone, university_id, verified_at, onboarded_at) values (${auth.id}, 'UTC', ${universityId}, now(), now())`;
      await sql`insert into reports (reporter, target_user, reason) values (${auth.id}, ${targetUserId}, 'spam')`;
    }
  });
}

test.describe('trust and safety (P4-T06)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a member blocks and reports from a profile; enough reports hide the account and it can appeal', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Safety University ${suffix}`, `safety-university-${suffix}`);
    const reporter = await signInTestMember(context, baseURL ?? '');
    const targetContext = await browser.newContext();
    const target = await signInTestMember(targetContext, baseURL ?? '');
    try {
      await prepareMember(reporter, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(target, { universityId, verifiedDaysAgo: 1, onboarded: true });
      // The default threshold is three distinct verified reporters; two have reported already.
      await seedReporters(universityId, target.userId, 2);

      await page.goto(`/u/${target.login}`);
      await page.getByRole('button', { name: 'Block' }).click();
      const blockDialog = page.getByRole('dialog', { name: `Block @${target.login}?` });
      await expect(blockDialog).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await blockDialog.getByRole('button', { name: 'Block' }).click();
      await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible(ACTION_TIMEOUT);
      await page.goto('/settings/privacy');
      await expect(page.getByRole('button', { name: `Unblock @${target.login}` })).toBeVisible(ACTION_TIMEOUT);

      await page.goto(`/u/${target.login}`);
      await page.getByRole('button', { name: 'Report' }).click();
      const reportDialog = page.getByRole('dialog', { name: `Report @${target.login}` });
      await reportDialog.getByRole('radio', { name: 'Harassment or bullying' }).check();
      await reportDialog.getByLabel('Details (optional)').fill('Keeps messaging after I said no.');
      await reportDialog.getByRole('button', { name: 'Send report' }).click();
      await expect(page.getByText('Thank you. Your report was sent to the moderators.')).toBeVisible(ACTION_TIMEOUT);

      // The third distinct reporter hides the account; the member sees a neutral notice and can appeal.
      const [row] = await withAppDatabase((sql) => sql<{ status: string }[]>`select status from users where id = ${target.userId}`);
      expect(row?.status).toBe('hidden_pending_review');
      const targetPage = await targetContext.newPage();
      await targetPage.goto('/home');
      await expect(targetPage.getByRole('heading', { name: 'Your account is hidden for now' })).toBeVisible(ACTION_TIMEOUT);
      await targetPage.getByRole('link', { name: 'Tell us your side' }).click();
      await expect(targetPage.getByText('Tell the moderators your side.')).toBeVisible(ACTION_TIMEOUT);
      await targetPage.getByLabel('Your message').fill('I only sent one message about the hackathon.');
      await targetPage.getByRole('button', { name: 'Send' }).click();
      await expect(targetPage.getByText('Thank you. We received your message.')).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(targetPage);
      const [appeal] = await withAppDatabase((sql) => sql`select page from feedback where user_id = ${target.userId}`);
      expect(appeal?.page).toBe('/feedback?about=appeal');
    } finally {
      await targetContext.close();
      await reporter.cleanup();
      await target.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });

  test('a moderator reads a reported message in context and suspends the member, all audited', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const name = `Moderated University ${suffix}`;
    const universityId = await seedUniversity(name, `moderated-university-${suffix}`);
    const moderator = await signInTestMember(context, baseURL ?? '');
    try {
      await prepareMember(moderator, { universityId, verifiedDaysAgo: 30, onboarded: true });
      const { targetId, targetLogin } = await withAppDatabase(async (sql) => {
        await sql`insert into roles (user_id, role, university_id) values (${moderator.userId}, 'uni_moderator', ${universityId})`;
        const people: { id: string; login: string }[] = [];
        for (const label of ['target', 'reporter']) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          if (!auth) throw new Error('auth.users insert returned no row');
          const login = `e2e-${label}-${suffix}`;
          await sql`insert into users (id) values (${auth.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, onboarded_at) values (${auth.id}, 'UTC', ${universityId}, now(), now())`;
          await sql`insert into github_identities (user_id, github_id, login) values (${auth.id}, ${710_000_000 + Number.parseInt(randomBytes(3).toString('hex'), 16)}, ${login})`;
          people.push({ id: auth.id, login });
        }
        const [target, reporter] = people as [{ id: string; login: string }, { id: string; login: string }];
        const [thread] = await sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
        await sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${target.id}), (${thread!.id}, ${reporter.id})`;
        await sql`insert into messages (thread_id, author_user_id, body, created_at) values (${thread!.id}, ${reporter.id}, 'Hi, are you joining the hackathon?', now() - interval '2 minutes')`;
        const [bad] = await sql<{ id: string }[]>`
          insert into messages (thread_id, author_user_id, body, created_at) values (${thread!.id}, ${target.id}, 'Send me your password or else.', now() - interval '1 minute') returning id`;
        await sql`insert into reports (reporter, target_user, target_message, reason, details) values (${reporter.id}, ${target.id}, ${bad!.id}, 'harassment', 'Threatening message.')`;
        return { targetId: target.id, targetLogin: target.login };
      });

      await page.goto('/admin/moderation');
      const card = page.getByRole('article', { name: `@${targetLogin}` });
      await expect(card).toBeVisible(ACTION_TIMEOUT);
      await expect(card.getByText('Threatening message.')).toBeVisible();
      await card.getByRole('button', { name: 'Show the message in context' }).click();
      await expect(card.getByText('Send me your password or else.')).toBeVisible(ACTION_TIMEOUT);
      await expect(card.getByText('Hi, are you joining the hackathon?')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await card.getByRole('radio', { name: 'Suspend for a number of days' }).check();
      await card.getByRole('spinbutton', { name: 'Days' }).fill('3');
      await card.getByLabel('Note (optional)').fill('Threats in chat.');
      await card.getByRole('button', { name: 'Record decision' }).click();
      await expect(card).toHaveCount(0, ACTION_TIMEOUT);
      await expect(page.getByText('No reports to review.')).toBeVisible();

      const [status] = await withAppDatabase((sql) => sql<{ status: string; suspended_until: Date | null }[]>`select status, suspended_until from users where id = ${targetId}`);
      expect(status?.status).toBe('suspended');
      expect(status?.suspended_until).not.toBeNull();
      const actions = await withAppDatabase(
        (sql) => sql<{ action: string }[]>`select action from audit_log where actor_user_id = ${moderator.userId} order by id`,
      );
      expect(actions.map((row) => row.action)).toEqual(['moderation.context_viewed', 'moderation.suspend']);
    } finally {
      await moderator.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
