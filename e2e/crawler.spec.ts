import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };

test.describe('country index (P6-T02)', () => {
  test('anyone can opt a login out of the index, and admins see the crawler', async ({ page, browser, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const login = `indexed-${suffix}`;
    const githubId = Number.parseInt(randomBytes(3).toString('hex'), 16) + 600_000_000;
    await withAppDatabase(async (sql) => {
      await sql`insert into gh_users (github_id, login, in_country_index, index_country_code, fetched_at) values (${githubId}, ${login}, true, 'TL', now())`;
      await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, fetched_at) values (${githubId * 10}, ${githubId}, ${`${login}/app`}, 'app', false, now())`;
      await sql`delete from rate_limit_buckets where key like 'tool:optout:%'`;
    });
    const adminContext = await browser.newContext({ baseURL: baseURL ?? '' });
    const admin = await signInTestMember(adminContext, baseURL ?? '');
    try {
      await page.goto('/');
      await page.getByRole('link', { name: 'Opt out of the index' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Opt out of the country index' })).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(page);
      await page.getByLabel('GitHub login').fill(`@${login.toUpperCase()}`);
      await page.getByRole('button', { name: 'Opt out' }).click();
      await expect(page.getByText('Done. That login is out of the index and will not be crawled again.')).toBeVisible(ACTION_TIMEOUT);
      const rows = await withAppDatabase(
        (sql) => sql`select (select count(*)::int from gh_users where github_id = ${githubId}) as users,
                            (select count(*)::int from gh_repos where owner_github_id = ${githubId}) as repos,
                            (select count(*)::int from crawl_optouts where github_login = ${login}) as optouts`,
      );
      expect(rows[0]).toEqual({ users: 0, repos: 0, optouts: 1 });

      await grantAdmin(admin.userId);
      const adminPage = await adminContext.newPage();
      await adminPage.goto('/admin/crawler');
      await expect(adminPage.getByRole('heading', { level: 1, name: 'Country crawler' })).toBeVisible(ACTION_TIMEOUT);
      await expect(adminPage.getByTestId('crawler-storage').getByText(/opted out\./)).toBeVisible();
      await expectNoSeriousA11yViolations(adminPage);
    } finally {
      await admin.cleanup();
      await adminContext.close();
      await withAppDatabase((sql) => sql`delete from crawl_optouts where github_login = ${login}`);
    }
  });
});
