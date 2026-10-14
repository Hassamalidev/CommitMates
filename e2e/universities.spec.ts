import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { prepareMember } from './helpers/members';
import { signInTestMember } from './helpers/session';

/** Server Action steps write to the database; allow for a loaded machine. */
const ACTION_TIMEOUT = { timeout: 15_000 };

/** A university in a test country, so the country picker has an entry. */
async function seedCountryUniversity(suffix: string): Promise<string> {
  const [row] = await withAppDatabase(
    (sql) => sql<{ id: string }[]>`
      insert into universities (name, slug, country, country_code, web_pages, source, checksum)
      values (${`Seed University ${suffix}`}, ${`seed-university-${suffix}`}, 'Testland', 'TL', '{}', 'admin', 'e2e') returning id`,
  );
  return row!.id;
}

test.describe('university requests (F10 step 6)', () => {
  // Two members, several Server Actions and page loads: more than the default 30 s under load.
  test.describe.configure({ timeout: 90_000 });

  test('a member requests an unknown university, an admin creates it, and the member can verify', async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const suffix = randomBytes(4).toString('hex');
    const domain = `new-${suffix}.edu`;
    const name = `New College ${suffix}`;
    const seeded = await seedCountryUniversity(suffix);
    await withAppDatabase(async (sql) => {
      await sql`delete from rate_limit_buckets where key like 'verify:ip:%'`;
      await sql`delete from email_daily_counts`;
    });
    const requester = await signInTestMember(context, baseURL ?? '');
    const adminContext = await browser.newContext();
    const admin = await signInTestMember(adminContext, baseURL ?? '');
    await grantAdmin(admin.userId);
    try {
      await page.goto('/onboarding');
      await page.waitForLoadState('networkidle');
      await page.getByLabel('University email').fill(`ada@${domain}`);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(
        page.getByText(`We don't recognize ${domain} as a university domain yet.`, { exact: false }),
      ).toBeVisible(ACTION_TIMEOUT);
      await page.getByLabel('University name').fill(name);
      await page.getByLabel('Country').selectOption('TL');
      await page.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText('Thanks. We will let you know once it is reviewed.')).toBeVisible(
        ACTION_TIMEOUT,
      );

      const adminPage = await adminContext.newPage();
      await adminPage.goto('/admin/universities');
      await expect(adminPage.getByRole('heading', { level: 1, name: 'Universities' })).toBeVisible();
      await expectNoSeriousA11yViolations(adminPage);
      const row = adminPage.getByRole('row').filter({ hasText: domain });
      await expect(row.getByLabel('University name')).toHaveValue(name);
      await row.getByRole('button', { name: 'Create university' }).click();
      await expect(adminPage.getByRole('row').filter({ hasText: domain })).toHaveCount(0, ACTION_TIMEOUT);

      // Back on onboarding: approved, and the domain now verifies by email.
      await page.goto('/onboarding');
      await expect(
        page.getByText(`Your request for ${domain} was approved.`, { exact: false }),
      ).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.getByLabel('University email').fill(`ada@${domain}`);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByText(`We sent a 6-digit code for ${name}.`)).toBeVisible(ACTION_TIMEOUT);

      const audit = await withAppDatabase(
        (sql) => sql`select action from audit_log where actor_user_id = ${admin.userId}`,
      );
      expect(audit.map((entry) => entry.action)).toContain('university_request.create');
    } finally {
      await requester.cleanup();
      await admin.cleanup();
      await adminContext.close();
      await withAppDatabase(async (sql) => {
        await sql`delete from universities where id = ${seeded} or name = ${name}`;
      });
    }
  });

  test('a moderator reviews universities but cannot open admin-only pages', async ({
    page,
    context,
    baseURL,
  }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedCountryUniversity(suffix);
    const moderator = await signInTestMember(context, baseURL ?? '');
    await withAppDatabase(async (sql) => {
      // Member rows are created on the first request; make sure they exist first.
      await sql`insert into users (id) values (${moderator.userId}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone) values (${moderator.userId}, 'UTC') on conflict (user_id) do nothing`;
      await sql`update profiles set university_id = ${universityId}, verified_at = now() where user_id = ${moderator.userId}`;
      await sql`insert into roles (user_id, role, university_id) values (${moderator.userId}, 'uni_moderator', ${universityId})`;
    });
    try {
      const response = await page.goto('/admin/universities');
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Universities' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link')).toHaveText(['Universities', 'Moderation']);
      // No moderator management for moderators.
      await expect(page.getByRole('heading', { name: 'Moderators' })).toHaveCount(0);
      await page.goto('/admin/moderation');
      await expect(page.getByText(`You moderate Seed University ${suffix}.`)).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      for (const path of [
        '/admin/health',
        '/admin/settings',
        '/admin/metrics',
        '/admin/roles',
        '/admin/audit',
      ]) {
        expect((await page.goto(path))?.status(), path).toBe(404);
      }
    } finally {
      await moderator.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${universityId}`);
    }
  });
});

test.describe('roles and audit (P3-T09)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('an admin makes a verified member a moderator and finds it in the audit log', async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedCountryUniversity(suffix);
    const admin = await signInTestMember(context, baseURL ?? '');
    await grantAdmin(admin.userId);
    const otherContext = await browser.newContext();
    const candidate = await signInTestMember(otherContext, baseURL ?? '');
    await prepareMember(candidate, { universityId, verifiedDaysAgo: 5, onboarded: true });
    try {
      await page.goto('/admin/roles');
      await expect(page.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.getByLabel('GitHub login').nth(1).fill(candidate.login);
      await page.getByLabel('University slug').fill(`seed-university-${suffix}`);
      await page.getByRole('button', { name: 'Make moderator' }).click();
      await expect(page.getByRole('row').filter({ hasText: `@${candidate.login}` })).toContainText(
        'Moderator',
        ACTION_TIMEOUT,
      );

      await page.goto('/admin/audit?action=role.');
      await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: candidate.userId })).toContainText('role.grant');
      await expectNoSeriousA11yViolations(page);
    } finally {
      await otherContext.close();
      await candidate.cleanup();
      await admin.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`update profiles set university_id = null where university_id = ${universityId}`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
