import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified members `unlock.fypBoard.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 10;
/** Confirmed past projects `fyp.minCorpus` asks for by default. */
const MIN_CORPUS = 30;

const IDEA = {
  title: 'Smart attendance with face recognition',
  description: 'A smart attendance system that recognizes students with face recognition from a classroom camera and shows a teacher dashboard.',
};

test.describe('FYP Board (P6-T07)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a supervisor is approved, an idea is checked against past projects and posted, and a classmate joins its team', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const area = `e2e-vision-${suffix}`;
    const universityId = await seedUniversity(`FYP University ${suffix}`, `fyp-university-${suffix}`);
    const author = await signInTestMember(context, baseURL ?? '');
    const otherContext = await browser.newContext();
    const supervisor = await signInTestMember(otherContext, baseURL ?? '');
    const similarRepo = `senior-${suffix}/attendance`;
    try {
      await prepareMember(author, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(supervisor, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await grantAdmin(author.userId);
      await withAppDatabase(async (sql) => {
        await sql`update profiles set role = 'supervisor_pending' where user_id = ${supervisor.userId}`;
        await sql`insert into topics (slug, display_name, aliases, related, blob_sha, synced_at) values (${area}, ${area}, '{}', '{}', 'e2e', now())`;
        for (let index = 0; index < UNLOCK_MEMBERS - 2; index += 1) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          await sql`insert into users (id) values (${auth!.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                    values (${auth!.id}, 'UTC', ${universityId}, now(), 'email', now())`;
        }
        // The university's past projects: one close to the idea, the rest about other things.
        const base = Number.parseInt(suffix, 16) * 100;
        await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, is_fork, fetched_at)
                  values (${base}, ${base}, ${similarRepo}, 'attendance', 'Face attendance', '{}', false, now())`;
        await sql`insert into fyp_projects (university_id, repo_github_id, confirmed, year, corpus_text) values (${universityId}, ${base}, true, 2024, ${IDEA.description})`;
        for (let index = 1; index < MIN_CORPUS; index += 1) {
          await sql`insert into fyp_projects (university_id, repo_github_id, confirmed, corpus_text)
                    values (${universityId}, ${base + index}, true, ${`A library catalogue app number ${index} for borrowing books and paying fines.`})`;
        }
      });

      // The supervisor applies with an area of the vocabulary.
      const theirs = await otherContext.newPage();
      await theirs.goto('/fyp');
      await theirs.getByRole('tab', { name: 'Supervisors' }).click();
      await theirs.getByLabel('Areas', { exact: true }).fill(area);
      await theirs.getByRole('button', { name: 'Apply as a supervisor' }).click();
      await expect(theirs.getByText('Sent. A moderator will review it.')).toBeVisible(ACTION_TIMEOUT);

      // An admin approves it from the moderation page.
      await page.goto('/admin/moderation');
      const application = page.getByRole('article', { name: `@${supervisor.login} at FYP University ${suffix}` });
      await expect(application.getByText(area)).toBeVisible(ACTION_TIMEOUT);
      await application.getByRole('button', { name: 'Approve' }).click();
      await expect(application).toHaveCount(0, ACTION_TIMEOUT);

      // The author checks an idea against the university's past projects, then posts it.
      await page.goto('/home');
      await page.getByRole('link', { name: 'Open the FYP Board' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Final-year projects at your university' })).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('tab', { name: 'Supervisors' }).click();
      await expect(page.getByRole('article', { name: `@${supervisor.login}` }).getByText(area)).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('tab', { name: 'Ideas' }).click();
      await page.getByLabel('Title', { exact: true }).fill(IDEA.title);
      await page.getByLabel('Description', { exact: true }).fill(IDEA.description);
      await page.getByRole('button', { name: 'Check idea' }).click();
      const closest = page.getByRole('list', { name: 'Closest past projects here' });
      await expect(closest.getByRole('link', { name: similarRepo })).toBeVisible(ACTION_TIMEOUT);
      await expect(closest.getByText(/^Very similar · \d+% similar$/).first()).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.getByRole('button', { name: 'Post idea' }).click();
      await page.waitForURL(/\/fyp\/ideas\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      const ideaUrl = page.url();
      await expect(page.getByRole('heading', { level: 1, name: IDEA.title })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Compared with past projects here' }).getByRole('link', { name: similarRepo })).toBeVisible();

      // A classmate asks to join; the author starts the team.
      await theirs.goto(ideaUrl);
      await theirs.getByLabel('Message to the author').fill('I supervise vision projects and would like to help.');
      await theirs.getByRole('button', { name: 'Ask to join' }).click();
      await expect(theirs.getByText('You asked to join: “I supervise vision projects and would like to help.”')).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(theirs);

      await page.reload();
      await page.getByLabel(new RegExp(`@${supervisor.login}`)).check();
      await page.getByRole('button', { name: 'Start the team' }).click();
      await page.waitForURL(/\/inbox\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      await expect(page.getByRole('log', { name: 'Messages' }).getByText(`Team for the final-year project idea “${IDEA.title}”. Say hello and plan how you will split the work.`)).toBeVisible(
        ACTION_TIMEOUT,
      );
    } finally {
      await otherContext.close();
      await author.cleanup();
      await supervisor.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from gh_repos where full_name = ${similarRepo}`;
        await sql`delete from universities where id = ${universityId}`;
        await sql`delete from topics where slug = ${area}`;
      });
    }
  });
});
