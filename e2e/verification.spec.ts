import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { signInTestMember } from './helpers/session';

/** Server Action steps write to the database and queue a job; allow for a loaded machine. */
const ACTION_TIMEOUT = { timeout: 15_000 };

/** The local Supabase stack's mail catcher (Mailpit). */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

/** Waits for the newest email to an address and returns its text body. */
async function latestEmailTo(address: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json()) as {
      messages: { ID: string }[];
    };
    const id = search.messages[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string };
      return message.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email to ${address} arrived`);
}

test.describe('university verification (e2e flow 4)', () => {
  test('a new member verifies with a university email code and reaches home', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const domain = `e2e-${suffix}.edu`;
    const name = `E2E University ${suffix}`;
    const address = `student@cs.${domain}`;
    const [university] = await withAppDatabase(async (sql) => {
      // Every run shares one day's email allowance and one address bucket; start each with them free.
      await sql`delete from email_daily_counts`;
      await sql`delete from rate_limit_buckets where key like 'verify:ip:%'`;
      const rows = await sql<{ id: string }[]>`
        insert into universities (name, slug, country, country_code, web_pages, source, checksum)
        values (${name}, ${`e2e-university-${suffix}`}, 'Testland', 'TL', '{}', 'admin', 'e2e') returning id`;
      await sql`insert into university_domains (domain, university_id) values (${domain}, ${rows[0]!.id})`;
      return rows;
    });
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      // Unverified members are sent to verify first.
      await page.goto('/home');
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Verify your university' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.waitForLoadState('networkidle');

      await page.getByLabel('University email').fill(address);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.getByText(`We sent a 6-digit code for ${name}.`)).toBeVisible(ACTION_TIMEOUT);

      const code = /\b(\d{6})\b/.exec(await latestEmailTo(address))?.[1];
      expect(code, 'code in the email').toBeDefined();
      await page.getByLabel('Verification code').fill(code ?? '');
      await page.getByRole('button', { name: 'Verify' }).click();

      await expect(page).toHaveURL(/\/home$/, ACTION_TIMEOUT);
      await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
      await expect(page.getByText(`Verified at ${name}.`)).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      const [profile] = await withAppDatabase((sql) => sql`select university_id, verified_via from profiles where user_id = ${member.userId}`);
      expect(profile).toMatchObject({ university_id: university!.id, verified_via: 'email' });
      // The address is forgotten once verified; only the domain stays.
      const rows = await withAppDatabase((sql) => sql`select email, domain from email_verifications where user_id = ${member.userId}`);
      expect(rows).toEqual([{ email: null, domain: `cs.${domain}` }]);
    } finally {
      await member.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${university!.id}`);
    }
  });

  test('a wrong code is reported next to the field', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const domain = `e2e-${suffix}.edu`;
    const [university] = await withAppDatabase(async (sql) => {
      await sql`delete from rate_limit_buckets where key like 'verify:ip:%'`;
      const rows = await sql<{ id: string }[]>`
        insert into universities (name, slug, country, country_code, web_pages, source, checksum)
        values (${`E2E University ${suffix}`}, ${`e2e-university-${suffix}`}, 'Testland', 'TL', '{}', 'admin', 'e2e') returning id`;
      await sql`insert into university_domains (domain, university_id) values (${domain}, ${rows[0]!.id})`;
      return rows;
    });
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await page.goto('/onboarding');
      await page.waitForLoadState('networkidle');
      await page.getByLabel('University email').fill(`ada@${domain}`);
      await page.getByRole('button', { name: 'Send code' }).click();
      const code = /\b(\d{6})\b/.exec(await latestEmailTo(`ada@${domain}`))?.[1] ?? '';
      await page.getByLabel('Verification code').fill(code === '000000' ? '111111' : '000000');
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page.getByLabel('Verification code')).toHaveAttribute('aria-invalid', 'true', ACTION_TIMEOUT);
      await expect(page.getByText(/That code is not right\. \d tries left\./)).toBeVisible();
    } finally {
      await member.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${university!.id}`);
    }
  });
});
