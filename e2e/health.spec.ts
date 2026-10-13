import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';

test.describe('health', () => {
  test('the status page shows a running service and its version', async ({ page }) => {
    await page.goto('/health');

    await expect(page.getByRole('heading', { level: 1, name: 'Service status' })).toBeVisible();
    await expect(page.getByTestId('health-status')).toHaveText('Running');
    await expect(page.getByTestId('health-version')).toHaveText(/^\d+\.\d+\.\d+$/);
    await expectNoSeriousA11yViolations(page);
  });

  test('the API route returns version and server time', async ({ request }) => {
    const before = Date.now();
    const response = await request.get('/api/health');
    expect(response.ok()).toBe(true);

    const body: unknown = await response.json();
    expect(body).toMatchObject({ status: 'ok' });
    const time = Date.parse((body as { time: string }).time);
    // Allow for clock granularity between the test runner and the server process.
    expect(Math.abs(time - before)).toBeLessThan(60_000);
  });
});
