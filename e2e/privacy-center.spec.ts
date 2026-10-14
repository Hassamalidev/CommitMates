import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };

test.describe('privacy center (e2e flow 8)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('a member saves privacy choices, exports their data and deletes their account', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    await prepareMember(member);
    try {
      await page.goto('/settings/privacy');
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy and data' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await page.getByLabel('Only me').check();
      await page.getByLabel(/Ghost mode/).check();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Saved.')).toBeVisible(ACTION_TIMEOUT);
      const [profile] = await withAppDatabase((sql) => sql`select visibility, ghost_mode from profiles where user_id = ${member.userId}`);
      expect(profile).toEqual({ visibility: 'hidden', ghost_mode: true });

      // The export is a JSON download of the member's rows.
      const download = await page.request.get('/api/me/export');
      expect(download.status()).toBe(200);
      expect(download.headers()['content-disposition']).toMatch(/attachment; filename="commitmates-export-\d{4}-\d{2}-\d{2}\.json"/);
      const exported = (await download.json()) as { tables: Record<string, unknown[]> };
      expect(exported.tables.profiles).toHaveLength(1);
      expect(exported.tables.github_identities).toHaveLength(1);

      // A wrong confirmation is refused next to the field.
      await page.getByLabel(`Type ${member.login} to confirm`).fill('not my login');
      await page.getByRole('button', { name: 'Delete my account' }).click();
      await expect(page.getByText(`Type ${member.login} to confirm.`)).toBeVisible(ACTION_TIMEOUT);

      await page.getByLabel(`Type ${member.login} to confirm`).fill(member.login);
      await page.getByRole('button', { name: 'Delete my account' }).click();
      await expect(page).toHaveURL(/\/\?account=deleted$/, ACTION_TIMEOUT);
      await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();

      const [left] = await withAppDatabase(
        (sql) => sql<{ users: number; auth: number; identities: number }[]>`
          select (select count(*) from users where id = ${member.userId})::int as users,
                 (select count(*) from auth.users where id = ${member.userId})::int as auth,
                 (select count(*) from github_identities where user_id = ${member.userId})::int as identities`,
      );
      expect(left).toEqual({ users: 0, auth: 0, identities: 0 });
      // Signed out: the members area asks to sign in again.
      const response = await page.request.get('/settings/privacy', { maxRedirects: 0 });
      expect(response.status()).toBe(307);
    } finally {
      await member.cleanup();
    }
  });
});
