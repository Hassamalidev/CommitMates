import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Showcased projects `unlock.legacy.minProjects` asks for by default. */
const UNLOCK_PROJECTS = 5;

test.describe("Senior's Legacy (P5-T09)", () => {
  test.describe.configure({ timeout: 120_000 });

  test('a member searches the library, opens a senior’s project and asks the author about it', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Legacy University ${suffix}`, `legacy-university-${suffix}`);
    const viewer = await signInTestMember(context, baseURL ?? '');
    const authorContext = await browser.newContext();
    const author = await signInTestMember(authorContext, baseURL ?? '');
    const year = new Date().getUTCFullYear();
    try {
      await prepareMember(viewer, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(author, { universityId, verifiedDaysAgo: 1, onboarded: true });
      const fullName = `${author.login}/robot-arm`;
      await withAppDatabase(async (sql) => {
        await sql`update profiles set role = 'alumni', grad_year = ${year - 1} where user_id = ${author.userId}`;
        const [identity] = await sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${author.userId}`;
        const githubId = Number(identity!.github_id);
        await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, stars, is_fork, fetched_at)
                  values (${githubId * 10 + 3}, ${githubId}, ${fullName}, 'robot-arm', 'Inverse kinematics for a six-axis arm', '{robotics}', 42, false, now())`;
        await sql`insert into legacy_entries (university_id, owner_user_id, repo_github_id, source, grad_year, tags, blurb, accepts_questions)
                  values (${universityId}, ${author.userId}, ${githubId * 10 + 3}, 'showcase', ${year - 1}, '{robotics,ros}', 'Our final-year robot arm.', true)`;
        // Other showcased projects so the library is open.
        for (let index = 0; index < UNLOCK_PROJECTS - 1; index += 1) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          const id = auth!.id;
          const otherGithubId = Number.parseInt(randomBytes(3).toString('hex'), 16) + 700_000_000;
          await sql`insert into users (id) values (${id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                    values (${id}, 'UTC', ${universityId}, now(), 'email', now())`;
          await sql`insert into github_identities (user_id, github_id, login) values (${id}, ${otherGithubId}, ${`e2e-legacy-${suffix}-${index}`})`;
          await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, stars, is_fork, fetched_at)
                    values (${otherGithubId * 10}, ${otherGithubId}, ${`e2e-legacy-${suffix}-${index}/notes`}, 'notes', 'Lecture notes app', '{react}', ${index}, false, now())`;
          await sql`insert into legacy_entries (university_id, owner_user_id, repo_github_id, source, tags, accepts_questions)
                    values (${universityId}, ${id}, ${otherGithubId * 10}, 'showcase', '{react}', false)`;
        }
      });

      await page.goto('/legacy');
      await expect(page.getByRole('heading', { level: 1, name: 'Projects from people who came before you' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('heading', { name: `${UNLOCK_PROJECTS} projects` })).toBeVisible();
      await page.getByLabel('Topic or idea').fill('kinematics');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('heading', { name: '1 project' })).toBeVisible(ACTION_TIMEOUT);
      const card = page.getByRole('article', { name: fullName });
      await expect(card.getByText(`by @${author.login} · Alumni · Class of ${year - 1}`)).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await card.getByRole('link', { name: `Open ${fullName}` }).click();
      await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByText('Our final-year robot arm.')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.getByRole('button', { name: `Ask @${author.login}` }).click();
      const dialog = page.getByRole('dialog', { name: `Ask @${author.login} about this project` });
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText(`Request sent to @${author.login}.`)).toBeVisible(ACTION_TIMEOUT);

      const authorPage = await authorContext.newPage();
      await authorPage.goto('/inbox');
      await expect(authorPage.getByText('· About your project in Senior’s Legacy')).toBeVisible(ACTION_TIMEOUT);
    } finally {
      await authorContext.close();
      await viewer.cleanup();
      await author.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
