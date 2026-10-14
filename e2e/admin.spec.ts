import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { signInTestMember } from './helpers/session';

const ADMIN_PATHS = ['/admin/health', '/admin/jobs', '/admin/settings', '/admin/settings/gap.maxGaps', '/admin/metrics'];

// These tests change shared rows (a schedule, a setting), so they must not interleave.
// Tests tagged with SHARED_STATE run in the desktop project only (see playwright.config.ts):
// the two viewports run in parallel against one database.
const SHARED_STATE = '@shared-state';
test.describe.configure({ mode: 'serial' });

test.describe('admin area access', () => {
  test('a signed-out visitor is sent to sign-in', async ({ request }) => {
    for (const path of ADMIN_PATHS) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers().location).toContain('/auth/sign-in');
    }
  });

  test('a member without the admin role gets a 404 on every admin page', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      for (const path of ADMIN_PATHS) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(404);
        await expect(page.getByRole('heading', { name: 'System health' })).toHaveCount(0);
      }
    } finally {
      await member.cleanup();
    }
  });
});

test.describe('admin pages', () => {
  test('health shows live data and is accessible', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await grantAdmin(member.userId);
      await page.goto('/admin/health');
      await expect(page.getByRole('heading', { level: 1, name: 'System health' })).toBeVisible();
      await expect(page.getByRole('progressbar', { name: 'Database size' })).toBeVisible();
      await expect(page.getByText(/MB used of a 450 MB budget/)).toBeVisible();
      await expect(page.getByText(/Dead jobs in the last 24 hours: \d+/)).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await member.cleanup();
    }
  });

  test('metrics show tool usage and conversion and are accessible', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await grantAdmin(member.userId);
      await page.goto('/admin/health');
      await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Metrics' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Metrics' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Tool usage' })).toBeVisible();
      await expect(page.getByTestId('tool-conversion')).toHaveText(/%|No anonymous run/);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await member.cleanup();
    }
  });

  test('a schedule can be disabled and enabled again, with an audit trail', { tag: SHARED_STATE }, async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await grantAdmin(member.userId);
      await page.goto('/admin/jobs');
      await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await page.getByRole('button', { name: 'Disable sync-linguist' }).click();
      await expect(page.getByRole('button', { name: 'Enable sync-linguist' })).toBeVisible();
      await page.getByRole('button', { name: 'Enable sync-linguist' }).click();
      await expect(page.getByRole('button', { name: 'Disable sync-linguist' })).toBeVisible();

      const actions = await withAppDatabase(
        (sql) => sql<{ action: string }[]>`
          select action from audit_log where actor_user_id = ${member.userId} and target_id = 'sync-linguist' order by id`,
      );
      expect(actions.map((row) => row.action)).toEqual(['schedule.disabled', 'schedule.enabled']);
    } finally {
      await member.cleanup();
    }
  });

  test('a setting can be overridden, rejects bad input, and can be cleared', { tag: SHARED_STATE }, async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await grantAdmin(member.userId);
      await page.goto('/admin/settings?q=gap.max');
      await expect(page.getByRole('status')).toContainText('Showing 1 of');
      await expectNoSeriousA11yViolations(page);
      await page.getByRole('link', { name: 'gap.maxGaps' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'gap.maxGaps' })).toBeVisible();

      const field = page.getByLabel('Override value (JSON)');
      await field.fill('five');
      await page.getByRole('button', { name: 'Save override' }).click();
      // Scoped to the form: Next.js adds its own live region to every page.
      await expect(page.locator('form').getByRole('alert')).toContainText('Enter the value as JSON');

      await field.fill('5');
      await page.getByRole('button', { name: 'Save override' }).click();
      await expect(page.locator('form').getByRole('status')).toHaveText('Saved.');
      await page.reload();
      await expect(page.getByRole('region', { name: 'History' })).toContainText('override');
      await expectNoSeriousA11yViolations(page);

      await page.getByLabel('Override value (JSON)').fill('');
      await page.getByRole('button', { name: 'Save override' }).click();
      await expect(page.locator('form').getByRole('status')).toHaveText('Saved.');
      const [row] = await withAppDatabase(
        (sql) => sql<{ override_value: unknown }[]>`select override_value from settings where key = 'gap.maxGaps'`,
      );
      expect(row?.override_value).toBeNull();
    } finally {
      await withAppDatabase((sql) => sql`update settings set override_value = null where key = 'gap.maxGaps'`);
      await member.cleanup();
    }
  });
});
