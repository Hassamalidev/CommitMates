import { randomBytes } from 'node:crypto';

import { expect, test, type Browser } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { cacheCard } from './helpers/dev-card';
import { signInTestMember, type TestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Member rows with a GitHub login, as a real sign-in would create; optionally verified long ago. */
async function prepareMember(
  member: TestMember,
  universityId: string | null,
  verifiedDaysAgo: number | null,
): Promise<void> {
  const verifiedAt = verifiedDaysAgo === null ? null : new Date(Date.now() - verifiedDaysAgo * DAY_MS);
  await withAppDatabase(async (sql) => {
    await sql`insert into users (id) values (${member.userId}) on conflict (id) do nothing`;
    await sql`insert into profiles (user_id, timezone) values (${member.userId}, 'UTC') on conflict (user_id) do nothing`;
    await sql`update profiles set university_id = ${universityId}, verified_at = ${verifiedAt}, verified_via = ${verifiedAt ? 'email' : null}
              where user_id = ${member.userId}`;
    await sql`insert into github_identities (user_id, github_id, login)
              values (${member.userId}, ${Number.parseInt(randomBytes(3).toString('hex'), 16) + 800_000_000}, ${member.login})
              on conflict (user_id) do nothing`;
  });
}

/** Signs in a member verified 30 days ago and vouches; `created` gets the member for cleanup first. */
async function vouchAs(
  browser: Browser,
  baseURL: string,
  universityId: string,
  login: string,
  created: TestMember[],
): Promise<void> {
  const context = await browser.newContext();
  const voucher = await signInTestMember(context, baseURL);
  created.push(voucher);
  await prepareMember(voucher, universityId, 30);
  const page = await context.newPage();
  await page.goto(`/u/${login}`);
  await expect(page.getByText(`@${login} is waiting for members of`, { exact: false })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('button', { name: `Vouch for @${login}` }).click();
  await expect(page.getByText('Thank you. Your vouch is recorded.')).toBeVisible(ACTION_TIMEOUT);
  await context.close();
}

test.describe('vouching (F10 step 5)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('two established members vouch and the newcomer is verified', async ({
    browser,
    page,
    context,
    baseURL,
  }) => {
    const suffix = randomBytes(4).toString('hex');
    const name = `Vouch University ${suffix}`;
    const [university] = await withAppDatabase(
      (sql) => sql<{ id: string }[]>`
        insert into universities (name, slug, country, country_code, web_pages, source, checksum)
        values (${name}, ${`vouch-university-${suffix}`}, 'Testland', 'TL', '{}', 'admin', 'e2e') returning id`,
    );
    const universityId = university!.id;
    const newcomer = await signInTestMember(context, baseURL ?? '');
    await prepareMember(newcomer, null, null);
    await cacheCard(newcomer.login, 4545);
    const vouchers: TestMember[] = [];
    try {
      await page.goto(`/onboarding?q=${encodeURIComponent(name)}`);
      await expect(page.getByRole('heading', { name: 'No university email?' })).toBeVisible();
      await page
        .getByRole('listitem')
        .filter({ hasText: name })
        .getByRole('button', { name: 'This is my university' })
        .click();
      await expect(page.getByText(`${name}: 0 of 2 vouches so far.`)).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('link', { name: new RegExp(`/u/${newcomer.login}$`) })).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      await vouchAs(browser, baseURL ?? '', universityId, newcomer.login, vouchers);
      await page.reload();
      await expect(page.getByText(`${name}: 1 of 2 vouches so far.`)).toBeVisible();

      await vouchAs(browser, baseURL ?? '', universityId, newcomer.login, vouchers);
      // Verified: home sends the newcomer through the onboarding details first.
      await page.goto('/home');
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Tell us about you' })).toBeVisible();
      await page.getByRole('button', { name: 'Finish' }).click();
      await expect(page).toHaveURL(/\/home$/, ACTION_TIMEOUT);
      await expect(page.getByText(`Verified at ${name}.`)).toBeVisible();
      const [profile] = await withAppDatabase(
        (sql) => sql`select verified_via from profiles where user_id = ${newcomer.userId}`,
      );
      expect(profile?.verified_via).toBe('vouch');
    } finally {
      for (const member of [newcomer, ...vouchers]) await member.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from analysis_cache where subject_key = ${newcomer.login.toLowerCase()}`;
        // A failed step may leave a member behind; detach it so the university can go and the real error shows.
        await sql`update profiles set university_id = null where university_id = ${universityId}`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
