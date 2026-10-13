import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';

test.describe('theme', () => {
  test('follows the system setting before any choice is made', async ({ browser }) => {
    for (const colorScheme of ['dark', 'light'] as const) {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      // Real computed colors: this is where contrast is checked in a browser.
      await expectNoSeriousA11yViolations(page);
      await context.close();
    }
  });

  test('the toggle switches theme and the choice survives a reload', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');

    await page.getByRole('button', { name: 'System theme' }).click();
    await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoSeriousA11yViolations(page);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();

    await page.getByRole('button', { name: 'Light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });

  test('headings use the pixel display font and body text does not', async ({ page }) => {
    await page.goto('/');
    const heading = await page.getByRole('heading', { level: 1 }).evaluate((node) => getComputedStyle(node).fontFamily);
    const body = await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily);
    expect(heading).toContain('Pixelify Sans');
    expect(body).toContain('Inter');
    expect(body).not.toContain('Pixelify');
  });
});
