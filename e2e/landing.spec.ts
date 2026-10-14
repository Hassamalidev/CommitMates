import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';

test.describe('landing page', () => {
  test('shows every section with one H1 and no accessibility violations', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your coding partner. Finish what you start.');
    for (const title of [
      'It always tells you what is happening',
      'Useful before anyone else joins',
      'Three steps to a real partner',
      'Features open as your campus joins',
      'Your data stays yours',
      'Frequently asked',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);
  });

  test('shows the companion in all five states', async ({ page }) => {
    await page.goto('/');
    const strip = page.locator('#states');
    for (const state of ['idle', 'working', 'waiting', 'done', 'error']) {
      await expect(strip.getByRole('img', { name: `The companion in its ${state} state` })).toBeVisible();
    }
  });

  test('lists the eight tools and links only to ones that exist', async ({ page, request }) => {
    await page.goto('/');
    const cards = page.locator('#tools li');
    await expect(cards).toHaveCount(8);
    const links = await page.locator('#tools a').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    for (const href of links) {
      expect((await request.get(href ?? '/missing')).ok(), `tool link ${href}`).toBe(true);
    }
  });

  test('answers a question in the FAQ', async ({ page }) => {
    await page.goto('/#faq');
    const question = page.getByRole('button', { name: 'Do you use AI to score me?' });
    await question.click();
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Scores come from counting and comparing')).toBeVisible();
  });

  test('fits the viewport without horizontal scrolling', async ({ page }) => {
    for (const path of ['/', '/privacy', '/attribution']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test('the skip link is the first stop and jumps to the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#content$/);
  });
});

test.describe('site pages', () => {
  for (const { path, link, heading } of [
    { path: '/privacy', link: 'Privacy', heading: 'Privacy policy' },
    { path: '/terms', link: 'Terms', heading: 'Terms of use' },
    { path: '/attribution', link: 'Attribution', heading: 'Attribution' },
  ]) {
    test(`${path} is reachable from the footer and accessible`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: link }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('an unknown address shows the friendly 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page' })).toBeAttached();
    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test('the site icon is the generated companion', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/brand-icon');
  const icon = await request.get('/brand-icon');
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(await icon.text()).toContain('<rect');
  expect(errors).toEqual([]);
});
