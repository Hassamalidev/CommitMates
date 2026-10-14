import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
// Changes a shared setting, so it runs in one project only and never alongside itself.
const SHARED_STATE = '@shared-state';

test.describe('university page (P3-T07)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows unlock progress from settings, and an admin override changes it', { tag: SHARED_STATE }, async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const name = `Campus University ${suffix}`;
    const slug = `campus-university-${suffix}`;
    const universityId = await seedUniversity(name, slug);
    const member = await signInTestMember(context, baseURL ?? '');
    await prepareMember(member, { universityId, verifiedDaysAgo: 1, onboarded: true });
    await grantAdmin(member.userId);
    try {
      await page.goto(`/uni/${slug}`);
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expect(page.getByText('1 verified member', { exact: false })).toBeVisible();
      const matching = page.getByRole('progressbar', { name: 'Find a partner' });
      await expect(matching).toHaveAttribute('aria-valuemax', '10');
      await expect(page.getByText('1 / 10 verified members').first()).toBeVisible();
      await expect(page.getByLabel('Your invite link')).toHaveValue(new RegExp(`\\?ref=${slug}&invite=[A-Za-z0-9_-]{12}$`));
      await expectNoSeriousA11yViolations(page);

      // The threshold is a setting: lowering it opens the feature without a code change.
      await page.goto('/admin/settings/unlock.matching.minMembers');
      await page.getByLabel('Override value (JSON)').fill('1');
      await page.getByRole('button', { name: 'Save override' }).click();
      await expect(page.locator('form').getByRole('status')).toHaveText('Saved.', ACTION_TIMEOUT);
      await page.goto(`/uni/${slug}`);
      await expect(page.getByRole('progressbar', { name: 'Find a partner' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Find a partner' }).locator('..')).toContainText('Open');

      // Home shows the same progress.
      await page.goto('/home');
      await expect(page.getByText(/\d+ of 8 campus features are open\./)).toBeVisible();
      await expect(page.getByRole('link', { name: 'See your university' })).toHaveAttribute('href', `/uni/${slug}`);
    } finally {
      await withAppDatabase((sql) => sql`update settings set override_value = null where key = 'unlock.matching.minMembers'`);
      await member.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${universityId}`);
    }
  });

  test('an invitee who verifies and onboards is credited to the inviter', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const slug = `invite-university-${suffix}`;
    const universityId = await seedUniversity(`Invite University ${suffix}`, slug);
    const inviter = await signInTestMember(context, baseURL ?? '');
    await prepareMember(inviter, { universityId, verifiedDaysAgo: 1, onboarded: true });
    const inviteeContext = await browser.newContext();
    const invitee = await signInTestMember(inviteeContext, baseURL ?? '');
    try {
      await page.goto(`/uni/${slug}`);
      const link = await page.getByLabel('Your invite link').inputValue();

      // The invitee follows the link, is verified there, and finishes onboarding.
      const inviteePage = await inviteeContext.newPage();
      await inviteePage.goto(new URL(link).pathname + new URL(link).search);
      await prepareMember(invitee, { universityId, verifiedDaysAgo: 0, onboarded: false });
      await inviteePage.goto('/onboarding');
      await expect(inviteePage.getByRole('heading', { level: 1, name: 'Tell us about you' })).toBeVisible();
      await inviteePage.getByRole('button', { name: 'Finish' }).click();
      await expect(inviteePage).toHaveURL(/\/home$/, ACTION_TIMEOUT);

      await page.reload();
      await expect(page.getByText('1 person joined with your link.')).toBeVisible();
    } finally {
      await inviteeContext.close();
      await invitee.cleanup();
      await inviter.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`update profiles set university_id = null where university_id = ${universityId}`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
