import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified alumni `unlock.alumni.minAlumni` asks for by default. */
const UNLOCK_ALUMNI = 5;

test.describe('Alumni Quick Asks (P6-T05)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a student asks anonymously, the best-matched alumnus answers and they meet in a conversation', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const topic = `e2e-alumni-${suffix}`;
    const universityId = await seedUniversity(`Alumni University ${suffix}`, `alumni-university-${suffix}`);
    const student = await signInTestMember(context, baseURL ?? '');
    const alumContext = await browser.newContext();
    const alum = await signInTestMember(alumContext, baseURL ?? '');
    process.env.LOG_LEVEL = 'warn';
    const core = await import('@commitmates/core');
    const db = await import('@commitmates/db');
    const body = `How did you find work with ${topic} after graduating?`;
    try {
      await prepareMember(student, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(alum, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await withAppDatabase(async (sql) => {
        await sql`insert into topics (slug, display_name, aliases, related, blob_sha, synced_at) values (${topic}, ${topic}, '{}', '{}', 'e2e', now())`;
        await sql`update profiles set role = 'alumni', grad_year = 2020 where user_id = ${alum.userId}`;
        await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                  values (${alum.userId}, ${sql.json({ [topic]: 1 })}, ${sql.json({ [topic]: 1 })}, ${[topic]}, '{}', now())`;
        // Other verified alumni so the feature is open; without skill vectors they are never asked.
        for (let index = 0; index < UNLOCK_ALUMNI - 1; index += 1) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          await sql`insert into users (id) values (${auth!.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at, role)
                    values (${auth!.id}, 'UTC', ${universityId}, now(), 'email', now(), 'alumni')`;
        }
      });

      await page.goto('/home');
      await page.getByRole('link', { name: 'Ask the alumni' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Ask the people who were here before' })).toBeVisible(ACTION_TIMEOUT);
      await page.getByLabel('Your question', { exact: true }).fill(body);
      await page.getByLabel('Topics', { exact: true }).fill(topic);
      await page.getByLabel(/Ask anonymously/).check();
      await page.getByRole('button', { name: 'Send question' }).click();
      await expect(page.getByText('Sent. We will pass it to alumni who know the topic.')).toBeVisible(ACTION_TIMEOUT);
      const mine = page.getByRole('article', { name: body.slice(0, 80) });
      await expect(mine.getByText('Waiting for an answer')).toBeVisible(ACTION_TIMEOUT);
      await expect(mine.getByText('Asked anonymously')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      // The first routing round runs as a job; run it here.
      const [question] = await withAppDatabase((sql) => sql<{ id: string }[]>`select id from alumni_questions where asker_user_id = ${student.userId}`);
      expect(await core.routeQuestion(question!.id, 1, new Date())).toEqual({ routed: 1, expired: false });

      const alumPage = await alumContext.newPage();
      await alumPage.goto('/alumni');
      const routed = alumPage.getByRole('article', { name: 'From a student, asking anonymously' });
      await expect(routed.getByText(body)).toBeVisible(ACTION_TIMEOUT);
      await expect(alumPage.getByText(`You are listed as an alumnus because your graduation year (2020) has passed.`)).toBeVisible();
      await expectNoSeriousA11yViolations(alumPage);
      await routed.getByRole('button', { name: 'Answer' }).click();
      await alumPage.waitForURL(/\/inbox\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      await expect(alumPage.getByRole('log', { name: 'Messages' }).getByText(`Alumni question: “${body}”`)).toBeVisible(ACTION_TIMEOUT);

      // Answered: the alumnus now sees who asked, and the student sees who answered.
      await alumPage.goto('/alumni');
      await expect(alumPage.getByRole('article', { name: `From @${student.login}` }).getByText('You answered')).toBeVisible(ACTION_TIMEOUT);
      await page.reload();
      await expect(mine.getByText(`Answered by @${alum.login}.`)).toBeVisible(ACTION_TIMEOUT);
      await mine.getByRole('link', { name: 'Open the conversation' }).click();
      await expect(page.getByRole('log', { name: 'Messages' }).getByText(`Alumni question: “${body}”`)).toBeVisible(ACTION_TIMEOUT);
    } finally {
      await db.closeDb();
      await alumContext.close();
      await student.cleanup();
      await alum.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
        await sql`delete from topics where slug = ${topic}`;
      });
    }
  });
});
