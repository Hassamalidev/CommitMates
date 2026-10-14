import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

/**
 * A comparison in the shape `compat_check` stores. The tests put it in the result cache,
 * so the page is exercised end to end (request, rate limit, cache, rendering) without a
 * call to GitHub.
 */
function comparison(a: string, b: string) {
  return {
    a: { login: a, name: 'Alice', githubId: 1001, isMember: false, companion: { seed: 1001, speciesKey: 'react', paletteHex: '#3178c6', stage: 2, traits: [] } },
    b: { login: b, name: null, githubId: 1002, isMember: false, companion: { seed: 1002, speciesKey: 'docker', paletteHex: null, stage: 1, traits: [] } },
    score: 72,
    band: 'strong-pair',
    components: { skill: 0.82, interest: 0.25, rhythm: 0.5, complement: 0.6 },
    explanations: {
      sharedTags: ['react', 'postgres'],
      sharedStars: ['facebook/react'],
      window: { startHourUtc: 21, hours: 2 },
      strengthA: 'postgres',
      strengthB: 'docker',
    },
  };
}

const unique = () => randomBytes(4).toString('hex');

async function cacheComparison(a: string, b: string) {
  const subject = [a.toLowerCase(), b.toLowerCase()].sort().join(':');
  await withAppDatabase(async (sql) => {
    await sql`
      insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
      values ('compat', ${subject}, 'default', ${sql.json(comparison(a, b))}, false, now(), now() + interval '1 hour')
      on conflict (kind, subject_key, params_hash) do update set result = excluded.result, expires_at = excluded.expires_at`;
    await sql`delete from rate_limit_buckets where key like 'tool:compat:%'`;
  });
  return subject;
}

test.describe('Compatibility Check', () => {
  test('shows a score, its band and four components for two people', async ({ page }) => {
    const a = `e2e-a-${unique()}`;
    const b = `e2e-b-${unique()}`;
    const subject = await cacheComparison(a, b);
    try {
      await page.goto(`/tools/compat?a=${a}&b=${b}`);

      const result = page.getByTestId('compat-result');
      await expect(result).toBeVisible();
      await expect(result.getByRole('heading', { name: `@${a} and @${b}` })).toBeVisible();
      await expect(result.getByRole('meter', { name: 'Compatibility score' })).toHaveAttribute('aria-valuenow', '72');
      await expect(result.getByText('Strong pair')).toBeVisible();
      await expect(result.locator('[data-component]')).toHaveCount(4);
      for (const name of ['Skills', 'Interests', 'Rhythm', 'Complement']) {
        await expect(result.getByText(name, { exact: true })).toBeVisible();
      }
      await expect(result.getByText('You both build with react, postgres.')).toBeVisible();
      await expect(result.getByText(/You are both most active between \d\d:00 and \d\d:00 your time\./)).toBeVisible();
      await expect(result.getByRole('img', { name: `The companion of @${a}` })).toBeVisible();
      await expect(result.getByRole('img', { name: `The companion of @${b}` })).toBeVisible();

      // A comparison is about people: not indexed, and not shareable unless both are public members.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
      expect((await page.request.get(`/api/og/compat?a=${a}&b=${b}`)).status()).toBe(404);

      // Visitors are invited to find people like this at their own university.
      await expect(page.getByRole('heading', { name: 'Find people like this at your uni' })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'compat' and subject_key = ${subject}`);
    }
  });

  test('the same two people in the other order are the same result', async ({ page }) => {
    const a = `e2e-a-${unique()}`;
    const b = `e2e-b-${unique()}`;
    const subject = await cacheComparison(a, b);
    try {
      await page.goto(`/tools/compat?a=${b}&b=${a}`);
      await expect(page.getByTestId('compat-result')).toBeVisible();
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'compat' and subject_key = ${subject}`);
    }
  });

  test('asks for two different usernames next to the second field', async ({ page }) => {
    await withAppDatabase((sql) => sql`delete from rate_limit_buckets where key like 'tool:compat:%'`);
    await page.goto('/tools/compat');
    await expect(page.getByRole('img', { name: 'The companion is idle' })).toBeVisible();
    await page.getByLabel('First GitHub username').fill('same-person');
    await page.getByLabel('Second GitHub username').fill('Same-Person');
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.getByText('Enter two different usernames.')).toBeVisible();
    await expect(page.getByLabel('Second GitHub username')).toHaveAttribute('aria-invalid', 'true');
    await expectNoSeriousA11yViolations(page);
  });
});
