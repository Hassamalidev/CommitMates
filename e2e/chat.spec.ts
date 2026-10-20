import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
// Realtime delivery goes through the local Supabase stack; allow it a little longer.
const LIVE_TIMEOUT = { timeout: 20_000 };
/** Verified members `unlock.matching.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 10;

/** Verified classmates so matching is open at the test university. */
async function seedClassmates(universityId: string, count: number): Promise<void> {
  await withAppDatabase(async (sql) => {
    for (let index = 0; index < count; index += 1) {
      const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      if (!auth) throw new Error('auth.users insert returned no row');
      await sql`insert into users (id) values (${auth.id}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                values (${auth.id}, 'UTC', ${universityId}, now(), 'email', now())`;
    }
  });
}

test.describe('chat (e2e flow 5)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a request from Discover is accepted and messages arrive in real time', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Chat University ${suffix}`, `chat-university-${suffix}`);
    const asker = await signInTestMember(context, baseURL ?? '');
    const otherContext = await browser.newContext();
    const answerer = await signInTestMember(otherContext, baseURL ?? '');
    try {
      await prepareMember(asker, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(answerer, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await seedClassmates(universityId, UNLOCK_MEMBERS - 2);
      const day = new Date().toISOString().slice(0, 10);
      await withAppDatabase(async (sql) => {
        for (const id of [asker.userId, answerer.userId]) {
          await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                    values (${id}, '{"react":1}', '{"react":1}', '{react}', '{}', now())`;
        }
        await sql`insert into match_suggestions (user_id, candidate_user_id, mode, score, components, explanation_keys, shown_on)
                  values (${asker.userId}, ${answerer.userId}, 'study', 0.8, '{}',
                          ${sql.json({ sharedTags: ['react'], coverage: [], sharedInterests: 0 })}, ${day})`;
      });

      // The asker opens Discover and sends a request with an opener built from a shared tag.
      await page.goto('/discover');
      await expect(page.getByRole('article', { name: `@${answerer.login}` })).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('button', { name: 'Request chat', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Message @${answerer.login}` });
      const opener = 'Hi! I see we both build with react. Want to compare notes, or build something together?';
      await dialog.getByRole('radio', { name: opener }).check();
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText(`Request sent to @${answerer.login}.`)).toBeVisible(ACTION_TIMEOUT);

      // The answerer sees it in their inbox, with its context, and accepts.
      const otherPage = await otherContext.newPage();
      await otherPage.goto('/home');
      await expect(otherPage.getByText(`@${asker.login} sent you a message request.`)).toBeVisible(ACTION_TIMEOUT);
      await otherPage.getByRole('link', { name: 'Open inbox' }).click();
      await expect(otherPage.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible(ACTION_TIMEOUT);
      await expect(otherPage.getByText('· From Discover')).toBeVisible();
      await expect(otherPage.getByText(opener)).toBeVisible();
      await expectNoSeriousA11yViolations(otherPage);
      await otherPage.getByRole('button', { name: `Accept the request from @${asker.login}` }).click();
      await expect(otherPage).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/, ACTION_TIMEOUT);
      await expect(otherPage.getByRole('log', { name: 'Messages' }).getByText(opener)).toBeVisible();

      // The asker opens the conversation and waits there.
      await page.goto('/inbox');
      await expect(page.getByRole('link', { name: new RegExp(`@${answerer.login}`) })).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('link', { name: new RegExp(`@${answerer.login}`) }).click();
      const askerLog = page.getByRole('log', { name: 'Messages' });
      await expect(askerLog.getByText(opener)).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(page);

      // A message from the answerer arrives without a reload, and the reply arrives the other way.
      await otherPage.getByLabel('Message', { exact: true }).fill('Hello! Yes, let us build something.');
      await otherPage.getByRole('button', { name: 'Send' }).click();
      await expect(askerLog.getByText('Hello! Yes, let us build something.')).toBeVisible(LIVE_TIMEOUT);
      await page.getByLabel('Message', { exact: true }).fill('Great, see https://github.com/topics/react for ideas.');
      await page.getByRole('button', { name: 'Send' }).click();
      const answererLog = otherPage.getByRole('log', { name: 'Messages' });
      await expect(answererLog.getByRole('link', { name: 'https://github.com/topics/react' })).toBeVisible(LIVE_TIMEOUT);
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
    } finally {
      await otherContext.close();
      await asker.cleanup();
      await answerer.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
