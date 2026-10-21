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

  test('a classmate finds the listing in the Graveyard uni tab, the owner accepts, and the adopter links a fork', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Adoption University ${suffix}`, `adoption-university-${suffix}`);
    const adopter = await signInTestMember(context, baseURL ?? '');
    const ownerContext = await browser.newContext();
    const owner = await signInTestMember(ownerContext, baseURL ?? '');
    const query = `react e2e ${suffix}`;
    try {
      await prepareMember(adopter, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(owner, { universityId, verifiedDaysAgo: 1, onboarded: true });
      const fullName = `${owner.login}/react-dash`;
      const { hashParams } = await import('@commitmates/core');
      await withAppDatabase(async (sql) => {
        const [identity] = await sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${owner.userId}`;
        const githubId = Number(identity!.github_id);
        const repoId = githubId * 10 + 2;
        await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, is_fork, stars, pushed_at, fetched_at)
                  values (${repoId}, ${githubId}, ${fullName}, 'react-dash', 'A react dashboard', '{react}', false, 12, now() - interval '200 days', now())`;
        const [listing] = await sql<{ id: string }[]>`
          insert into graveyard_listings (repo_github_id, owner_user_id, status, note) values (${repoId}, ${owner.userId}, 'listed', 'Needs a frontend') returning id`;
        // The uni search itself is covered against Postgres in core; here its result is cached for the adopter.
        const result = {
          query,
          scope: 'uni',
          terms: ['react'],
          items: [
            {
              githubId: repoId,
              fullName,
              description: 'A react dashboard',
              stars: 12,
              forks: 0,
              openIssues: 0,
              licenseSpdx: null,
              archived: false,
              pushedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
              idleMonths: 6.6,
              category: 'react',
              difficulty: null,
              unfinished: 1,
              revivability: 0.4,
              rank: 0.4,
              signals: { readmeUnfinished: true, unansweredIssues: null, unfinishedCommits: null, noReleases: true },
              listing: { id: listing!.id, note: 'Needs a frontend', ownerLogin: owner.login },
            },
          ],
          suggestions: [],
        };
        await sql`
          insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
          values ('graveyard', ${`uni:${query}`}, ${hashParams({ member: adopter.userId })}, ${sql.json(result)}, true, now(), now() + interval '1 hour')`;
        await sql`delete from rate_limit_buckets where key like 'tool:graveyard:%'`;
      });

      // The adopter searches their university's listings and asks to adopt.
      await page.goto(`/tools/graveyard?scope=uni&q=${encodeURIComponent(query)}`);
      const card = page.getByRole('article', { name: fullName });
      await expect(card.getByText('Up for adoption')).toBeVisible(ACTION_TIMEOUT);
      await expect(card.getByText(`Listed by @${owner.login}`)).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await card.getByRole('button', { name: `Adopt ${fullName}` }).click();
      const dialog = page.getByRole('dialog', { name: `Adopt ${fullName}` });
      const message = 'Hi! I would love to pick this up and build the frontend it needs this term.';
      await dialog.getByLabel('Message').fill(message);
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText(`Request sent. @${owner.login}'s reply will appear in your inbox.`)).toBeVisible(ACTION_TIMEOUT);

      // The owner sees the request with its context and accepts.
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto('/inbox');
      await expect(ownerPage.getByText('· About adopting your project')).toBeVisible(ACTION_TIMEOUT);
      await ownerPage.getByRole('button', { name: `Accept the request from @${adopter.login}` }).click();
      await expect(ownerPage).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      await ownerPage.goto('/settings/projects');
      await expect(ownerPage.getByText(`${fullName} was adopted but has no license`, { exact: false })).toBeVisible(ACTION_TIMEOUT);
      await expect(ownerPage.getByRole('link', { name: `Add a license to ${fullName}` })).toHaveAttribute('href', `https://github.com/${fullName}/community/license/new`);

      // The adopter links the fork they work in.
      await page.goto('/settings/projects');
      const adopting = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Projects you are adopting' }) });
      await expect(adopting.getByText('Adopted')).toBeVisible(ACTION_TIMEOUT);
      await adopting.getByLabel('Your fork').fill(`https://github.com/${adopter.login}/react-dash`);
      await adopting.getByRole('button', { name: `Link your fork of ${fullName}` }).click();
      await expect(adopting.getByText(`Working in ${adopter.login}/react-dash`)).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await owner.cleanup();
      await adopter.cleanup();
      await ownerContext.close();
      await withAppDatabase(async (sql) => {
        await sql`delete from analysis_cache where kind = 'graveyard' and subject_key = ${`uni:${query}`}`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
