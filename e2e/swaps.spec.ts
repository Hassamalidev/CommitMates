import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified members `unlock.swap.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 10;

test.describe('Skill Swap (P5-T06)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('two members who can teach each other accept a proposed swap and get a group conversation', async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Swap University ${suffix}`, `swap-university-${suffix}`);
    const first = await signInTestMember(context, baseURL ?? '');
    const secondContext = await browser.newContext();
    const second = await signInTestMember(secondContext, baseURL ?? '');
    process.env.LOG_LEVEL = 'warn';
    const core = await import('@commitmates/core');
    const db = await import('@commitmates/db');
    try {
      await prepareMember(first, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(second, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await withAppDatabase(async (sql) => {
        // Verified classmates so the Skill Swap is open, with skill vectors that teach nothing.
        for (let index = 0; index < UNLOCK_MEMBERS - 2; index += 1) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          await sql`insert into users (id) values (${auth!.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                    values (${auth!.id}, 'UTC', ${universityId}, now(), 'email', now())`;
        }
        // The first member's code shows TypeScript and they want Go; the second the other way round.
        await sql`update profiles set learning_goals = '{go}' where user_id = ${first.userId}`;
        await sql`update profiles set learning_goals = '{typescript}' where user_id = ${second.userId}`;
        for (const [userId, tag] of [
          [first.userId, 'typescript'],
          [second.userId, 'go'],
        ] as const) {
          await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                    values (${userId}, ${sql.json({ [tag]: 1 })}, ${sql.json({ [tag]: 0.9 })}, ${[tag]}, '{}', now())`;
        }
      });

      // Tonight's run proposes the pair.
      expect((await core.proposeSwaps(universityId, new Date())).proposed).toBe(1);

      await page.goto('/swaps');
      await expect(page.getByRole('heading', { level: 1, name: 'Teach what you know, learn what you want' })).toBeVisible(ACTION_TIMEOUT);
      const proposal = page.getByRole('article', { name: `@${second.login}` });
      await expect(proposal.getByText(`you helps @${second.login} with typescript`)).toBeVisible();
      await expect(proposal.getByText(`@${second.login} helps you with go`)).toBeVisible();
      await expect(page.getByText(/Verified · More than \d+% of members here/)).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await proposal.getByRole('button', { name: `Accept the swap with @${second.login}` }).click();
      await expect(proposal.getByText('You accepted. Waiting for the others.')).toBeVisible(ACTION_TIMEOUT);

      const secondPage = await secondContext.newPage();
      await secondPage.goto('/swaps');
      const theirs = secondPage.getByRole('article', { name: `@${first.login}` });
      await theirs.getByRole('button', { name: `Accept the swap with @${first.login}` }).click();
      await expect(theirs.getByText('Everyone accepted. Your group conversation is in your inbox.')).toBeVisible(ACTION_TIMEOUT);

      await secondPage.goto('/inbox');
      await secondPage.getByRole('link', { name: new RegExp(`@${first.login}`) }).click();
      // The note lists each step; which comes first depends on the cycle's starting member.
      const log = secondPage.getByRole('log', { name: 'Messages' });
      await expect(log.getByText(new RegExp(`^Skill swap: .*@${first.login} helps @${second.login} with typescript`))).toBeVisible(ACTION_TIMEOUT);
      await expect(log.getByText(new RegExp(`@${second.login} helps @${first.login} with go`))).toBeVisible();
    } finally {
      await db.closeDb();
      await secondContext.close();
      await first.cleanup();
      await second.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
