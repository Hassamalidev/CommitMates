import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };

test.describe('adoption listings (P5-T02)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('an owner lists a privately suggested project with a note, and withdraws it', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Listing University ${suffix}`, `listing-university-${suffix}`);
    const owner = await signInTestMember(context, baseURL ?? '');
    try {
      await prepareMember(owner, { universityId, verifiedDaysAgo: 1, onboarded: true });
      const fullName = `${owner.login}/paused-app`;
      await withAppDatabase(async (sql) => {
        const [identity] = await sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${owner.userId}`;
        const githubId = Number(identity!.github_id);
        const repoId = githubId * 10 + 1;
        await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, is_fork, pushed_at, fetched_at)
                  values (${repoId}, ${githubId}, ${fullName}, 'paused-app', false, now() - interval '400 days', now()),
                         (${repoId + 1}, ${githubId}, ${`${owner.login}/other-app`}, 'other-app', false, now(), now())`;
        await sql`insert into listing_suggestions (owner_user_id, repo_github_id, suggested_at) values (${owner.userId}, ${repoId}, now())`;
      });

      await page.goto('/home');
      await page.getByRole('link', { name: 'Put a paused project up for adoption' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Your projects' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('heading', { name: 'These look paused' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      const suggestion = page.getByRole('listitem').filter({ hasText: fullName });
      await suggestion.getByLabel('Note (optional)').fill('Needs a frontend');
      await suggestion.getByRole('button', { name: `List ${fullName} for adoption` }).click();
      const listed = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Up for adoption' }) });
      await expect(listed.getByText('Needs a frontend')).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('heading', { name: 'These look paused' })).toHaveCount(0);

      await listed.getByRole('button', { name: `Withdraw ${fullName}` }).click();
      await expect(listed.getByText('Nothing listed yet.')).toBeVisible(ACTION_TIMEOUT);
      const [row] = await withAppDatabase((sql) => sql`select status from graveyard_listings where owner_user_id = ${owner.userId}`);
      expect(row?.status).toBe('withdrawn');
    } finally {
      await owner.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${universityId}`);
    }
  });
});
