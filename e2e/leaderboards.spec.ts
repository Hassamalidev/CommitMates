import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified members `unlock.leaderboard.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 15;

test.describe('leaderboards (P6-T04)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a member sees their university ranked per capita and joins the members board', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Board University ${suffix}`, `board-university-${suffix}`);
    const rivalId = await seedUniversity(`Rival University ${suffix}`, `rival-university-${suffix}`);
    const viewer = await signInTestMember(context, baseURL ?? '');
    const lastMonday = (offsetWeeks: number) => {
      const now = new Date();
      const day = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day - 7 * offsetWeeks)).toISOString().slice(0, 10);
    };
    const [week, previous] = [lastMonday(1), lastMonday(2)];
    // Rows from a past run of the weekly job are kept under their own week; use a country of their own.
    const country = 'TL';
    try {
      await prepareMember(viewer, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await withAppDatabase(async (sql) => {
        for (let index = 0; index < UNLOCK_MEMBERS - 1; index += 1) {
          const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
          await sql`insert into users (id) values (${auth!.id}) on conflict (id) do nothing`;
          await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
                    values (${auth!.id}, 'UTC', ${universityId}, now(), 'email', now())`;
        }
        const rows = [
          ['university', universityId, country, week, { activeRatio: 0.6, medianActiveDays: 4, revivals: 1, helpfulReviews: 2 }, 0.9, 1],
          ['university', rivalId, country, week, { activeRatio: 0.2, medianActiveDays: 1, revivals: 0, helpfulReviews: 0 }, 0.1, 2],
          ['university', universityId, country, previous, { activeRatio: 0.1, medianActiveDays: 0, revivals: 0, helpfulReviews: 0 }, 0, 2],
        ] as const;
        for (const [scope, scopeId, groupId, weekStart, metrics, score, rank] of rows) {
          await sql`insert into leaderboard_snapshots (scope, scope_id, group_id, week_start, metrics, score, rank)
                    values (${scope}, ${scopeId}, ${groupId}, ${weekStart}, ${sql.json(metrics)}, ${score}, ${rank})
                    on conflict (scope, scope_id, week_start) do update set metrics = excluded.metrics, score = excluded.score, rank = excluded.rank, group_id = excluded.group_id`;
        }
      });

      await page.goto('/home');
      await page.getByRole('link', { name: 'Open the leaderboards' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Who kept coding this week' })).toBeVisible(ACTION_TIMEOUT);
      const mine = page.getByRole('article', { name: `Board University ${suffix}` });
      await expect(mine.getByText('#1')).toBeVisible();
      await expect(mine.getByText('Up 1')).toBeVisible();
      await expect(mine.getByText('60% of members active · median 4 active days · 1 revival · 2 helpful reviews')).toBeVisible();
      await expect(page.getByRole('article', { name: `Rival University ${suffix}` }).getByText('New this week')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await page.getByRole('button', { name: 'Join the members board' }).click();
      await expect(page.getByRole('button', { name: 'Leave the members board' })).toBeVisible(ACTION_TIMEOUT);
      expect(await withAppDatabase((sql) => sql`select 1 from leaderboard_optins where user_id = ${viewer.userId}`)).toHaveLength(1);
    } finally {
      await viewer.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from leaderboard_snapshots where scope_id in (${universityId}, ${rivalId})`;
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id in (${universityId}, ${rivalId})`;
      });
    }
  });
});
