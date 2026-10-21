import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
// Changes a shared setting (the grace hours), so it runs once and never alongside itself.
const SHARED_STATE = '@shared-state';
const DAY_MS = 24 * 60 * 60 * 1000;

const utcDate = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

/**
 * Answers the job's GitHub calls in this test process: the rate-limit probe and the contribution
 * calendar, with the counts given per login and date. Everything else goes to the real `fetch`.
 */
function stubGitHub(counts: Record<string, Record<string, number>>): () => void {
  const original = globalThis.fetch;
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const headers = { 'content-type': 'application/json' };
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== 'api.github.com') return original(input, init);
    if (url.pathname === '/rate_limit') {
      return new Response(JSON.stringify({ resources: { core: { limit: 5000, remaining: 4900, reset }, graphql: { limit: 5000, remaining: 4900, reset } } }), { headers });
    }
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { variables: { login: string; from: string; to: string } };
    const contributionDays: { date: string; contributionCount: number }[] = [];
    for (let time = Date.parse(body.variables.from.slice(0, 10)); time <= Date.parse(body.variables.to.slice(0, 10)); time += DAY_MS) {
      const date = new Date(time).toISOString().slice(0, 10);
      contributionDays.push({ date, contributionCount: counts[body.variables.login]?.[date] ?? 0 });
    }
    return new Response(
      JSON.stringify({
        data: {
          user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays }] } } },
          rateLimit: { limit: 5000, cost: 1, remaining: 4990, resetAt: new Date(reset * 1000).toISOString() },
        },
      }),
      { headers },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

test.describe('shared streaks (e2e flow 7)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('two members start a streak, and two judged days count one and freeze one', { tag: SHARED_STATE }, async ({ browser, page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Streak University ${suffix}`, `streak-university-${suffix}`);
    const inviter = await signInTestMember(context, baseURL ?? '');
    const partnerContext = await browser.newContext();
    const partner = await signInTestMember(partnerContext, baseURL ?? '');
    // The job runs in this test process; its info logs would only clutter the report.
    process.env.LOG_LEVEL = 'warn';
    const core = await import('@commitmates/core');
    const db = await import('@commitmates/db');
    const jobs = await import('@commitmates/jobs');
    let restoreFetch: () => void = () => undefined;
    try {
      await prepareMember(inviter, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await prepareMember(partner, { universityId, verifiedDaysAgo: 1, onboarded: true });
      const threadId = await withAppDatabase(async (sql) => {
        const [thread] = await sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
        await sql`insert into thread_members (thread_id, user_id) values (${thread!.id}, ${inviter.userId}), (${thread!.id}, ${partner.userId})`;
        await sql`insert into messages (thread_id, author_user_id, body) values (${thread!.id}, ${inviter.userId}, 'Want to keep each other coding every day?')`;
        return thread!.id;
      });

      // The inviter starts a streak from the conversation; the partner accepts it.
      await page.goto(`/inbox/${threadId}`);
      await page.getByRole('button', { name: 'Start a shared streak' }).click();
      await expect(page.getByText('Streak invitation sent.')).toBeVisible(ACTION_TIMEOUT);
      const partnerPage = await partnerContext.newPage();
      await partnerPage.goto('/streaks');
      await expect(partnerPage.getByText(`@${inviter.login} invited you to a shared streak.`)).toBeVisible(ACTION_TIMEOUT);
      await expectNoSeriousA11yViolations(partnerPage);
      await partnerPage.getByRole('button', { name: `Accept the streak invitation from @${inviter.login}` }).click();
      const card = partnerPage.getByRole('article', { name: `With @${inviter.login}` });
      await expect(card).toBeVisible(ACTION_TIMEOUT);
      await expect(card.getByText('The first day is judged once it is over for both of you.')).toBeVisible();

      // Two simulated days: the pair started two days ago with one freeze in hand. Day one both
      // members commit; day two only one does, so the freeze is used.
      const [dayOne, dayTwo] = [utcDate(-2), utcDate(-1)];
      await withAppDatabase(async (sql) => {
        await sql`update pairs set created_at = ${`${dayOne}T12:00:00Z`}, freezes_available = 1
                  where user_a in ${sql([inviter.userId, partner.userId])} and user_b in ${sql([inviter.userId, partner.userId])}`;
        for (const userId of [inviter.userId, partner.userId]) {
          await sql`update github_identities set token_enc = ${db.encrypt(`gho_e2e_${userId}`)}, token_key_version = 1, token_invalid = false where user_id = ${userId}`;
        }
        // Judge as soon as a day is over (the default grace is 6 hours after midnight).
        await sql`update settings set override_value = '0'::jsonb where key = 'streaks.graceHours'`;
      });
      // Other in-process tests in this worker may have cached the settings table; read it fresh.
      db.clearSettingsCache();
      restoreFetch = stubGitHub({ [inviter.login]: { [dayOne]: 3, [dayTwo]: 2 }, [partner.login]: { [dayOne]: 1, [dayTwo]: 0 } });
      core.registerAllHandlers();
      const dispatch = await jobs.enqueue('streak_check', {}, { idempotencyKey: `e2e-streaks:${suffix}` });
      await jobs.runTick({ budgetMs: 30_000, onlyJobId: dispatch.id });
      const queued = await withAppDatabase(
        (sql) => sql<{ id: string }[]>`select id from jobs where type = 'streak_check' and status = 'queued' and payload->>'day' = ${dayOne}
                                       and payload->>'pairId' in (select id::text from pairs where user_a in ${sql([inviter.userId, partner.userId])})`,
      );
      expect(queued).toHaveLength(1);
      await jobs.runTick({ budgetMs: 30_000, onlyJobId: queued[0]!.id });

      const outcomes = await withAppDatabase(
        (sql) => sql<{ day: string; outcome: string }[]>`
          select d.day::text, d.outcome from pair_days d join pairs p on p.id = d.pair_id
          where p.user_a in ${sql([inviter.userId, partner.userId])} order by d.day`,
      );
      expect(outcomes.map((row) => [row.day, row.outcome])).toEqual([
        [dayOne, 'counted'],
        [dayTwo, 'frozen'],
      ]);

      await partnerPage.reload();
      await expect(card.getByText('Current streak')).toBeVisible(ACTION_TIMEOUT);
      await expect(card.getByRole('definition').first()).toHaveText('1 day');
      await expect(card.getByText(`Judged up to ${dayTwo}.`)).toBeVisible();
      // The shared companion rests after a frozen day; the strip shows both days.
      await expect(card.getByRole('img', { name: `Your shared companion with @${inviter.login}, resting` })).toBeVisible();
      await expect(card.getByText('The last 30 days')).toBeVisible();
      await expect(card.getByText(`${dayOne}: Both coded`)).toBeAttached();
      await expect(card.getByText(`${dayTwo}: Freeze used`)).toBeAttached();
      // Neither profile is public, so there is no share card.
      await expect(card.getByRole('link', { name: /Share card/ })).toHaveCount(0);
      await expectNoSeriousA11yViolations(partnerPage);
    } finally {
      restoreFetch();
      await withAppDatabase((sql) => sql`update settings set override_value = null where key = 'streaks.graceHours'`);
      await db.closeDb();
      await partnerContext.close();
      await inviter.cleanup();
      await partner.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
