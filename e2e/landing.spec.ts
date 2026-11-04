import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { cacheCard, uniqueLogin } from './helpers/dev-card';

test.describe('landing page', () => {
  test('shows every section with one H1 and no accessibility violations', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find your coding partner. Finish what you start.');
    for (const title of [
      'Run it on a real profile',
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

  test('the live demo runs a real Dev Card and shows the card', async ({ page }) => {
    const login = uniqueLogin();
    await cacheCard(login, 4343);
    try {
      await page.goto('/');
      await page.getByRole('link', { name: 'Try it with your GitHub' }).click();
      await expect(page).toHaveURL(/#demo$/);
      const demo = page.locator('#demo');
      await demo.getByLabel('GitHub username').fill(login);
      await demo.getByRole('button', { name: 'Run' }).click();
      const log = demo.getByRole('log');
      await expect(log.getByText(`commitmates card ${login}`)).toBeVisible();
      await expect(log.getByText('Card ready. It is just below.')).toBeVisible();
      await expect(demo.getByRole('img', { name: 'The demo companion is done' })).toBeVisible();
      await expect(demo.getByTestId('dev-card').getByRole('heading', { name: "Fixture User's Dev Card" })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${login}`);
    }
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
    const question = page.locator('#faq details').filter({ hasText: 'Do you use AI to score me?' });
    await expect(question).not.toHaveAttribute('open');
    // Opened from the keyboard: the native disclosure needs no JavaScript.
    await question.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('open');
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

  test('the attribution page credits the synced sources and every shipped package', async ({ page }) => {
    await page.goto('/attribution');
    // Each synced source is credited, with its last sync when one has run (source_snapshots).
    for (const source of ['GitHub Linguist', 'github/explore', 'gitleaks', 'stopwords-iso', 'Hipo university-domains-list', 'disposable-email-domains']) {
      await expect(page.getByRole('link', { name: source, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/^(Last synced .+|Not synced yet)\.$/).first()).toBeVisible();
    // The package table comes from the dependency license report, including attribution licenses.
    const packages = page.getByRole('table', { name: 'Open-source packages in the site, with their licenses' });
    await expect(packages.getByRole('row', { name: /^next MIT$/ })).toBeVisible();
    await expect(packages.getByRole('row', { name: /^caniuse-lite CC-BY-4.0$/ })).toBeVisible();
    expect(await packages.getByRole('row').count()).toBeGreaterThan(100);
    // Policies end with a way to reach us, and are no longer drafts.
    await expect(page.getByText(/^Questions about this page, or a request about your data: .+@.+\.$/)).toBeVisible();
    await expect(page.getByText(/will be finalized before public launch/)).toHaveCount(0);
  });

  test('a visitor sends feedback from the footer, stored without an identifier', async ({ page }) => {
    const body = `The landing demo was clear (${Date.now()}).`;
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Feedback' }).click();
    await expect(page).toHaveURL(/\/feedback$/);
    await page.getByLabel('Your message').fill(body);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Thank you. We received your message.')).toBeVisible();
    const rows = await withAppDatabase((sql) => sql<{ user_id: string | null }[]>`select user_id from feedback where body = ${body}`);
    expect(rows).toEqual([{ user_id: null }]);
    await withAppDatabase((sql) => sql`delete from feedback where body = ${body}`);
  });

  test('an unknown address shows the friendly 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find that page' })).toBeAttached();
    await page.getByRole('link', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test('robots and the sitemap list public pages only', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toContain('Disallow: /admin');
  expect(robots).toMatch(/Sitemap: .+\/sitemap\.xml/);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/tools/dev-card', '/tools/fyp-check', '/privacy']) expect(sitemap).toContain(`${path}</loc>`);
  expect(sitemap).not.toContain('/admin');
  expect(sitemap).not.toContain('/u/');
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
