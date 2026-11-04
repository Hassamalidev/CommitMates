import { expect, test } from '@playwright/test';

/**
 * Checks that need a deployed site with live data (P7-T07): a real day-one tool run against GitHub,
 * and reference data synced by the job tick. Runs only with E2E_BASE_URL set (playwright.config.ts).
 * The account analyzed is public; its result is kept no longer than privacy.nonUserRawTtlHours.
 */

/** A public personal GitHub account to build a Dev Card for; GitHub's own mascot account by default. */
const LOGIN = process.env.E2E_TOOL_LOGIN ?? 'octocat';
/** A cold run reads repositories and activity from GitHub through the job queue. */
const LIVE_RUN_MS = 120_000;

test.describe('deployed site', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a real Dev Card is built from live GitHub data', async ({ page }) => {
    await page.goto('/tools/dev-card');
    await page.getByLabel('GitHub username').fill(LOGIN);
    await page.getByRole('button', { name: 'Build card' }).click();
    const card = page.getByTestId('dev-card');
    await expect(card).toBeVisible({ timeout: LIVE_RUN_MS });
    await expect(card.getByRole('img', { name: new RegExp(`companion of @${LOGIN}`, 'i') })).toBeVisible();
    // A visitor's result about someone else is never indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the job tick has synced the reference data', async ({ page }) => {
    await page.goto('/attribution');
    // Every synced source shows its last sync once the first ticks have run (docs/runbooks/deploy.md step 5).
    await expect(page.getByText('Not synced yet.')).toHaveCount(0);
    expect(await page.getByText(/^Last synced .+\.$/).count()).toBeGreaterThanOrEqual(6);
  });
});
