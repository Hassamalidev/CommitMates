import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';

/**
 * Browser-only checks of a running site (P7-T07). They touch no database directly, so they run in the
 * local suite and against a deployed site: `E2E_BASE_URL=https://<site> pnpm exec playwright test`
 * runs only these and `staging.spec.ts` (docs/runbooks/launch.md).
 */

const PUBLIC_PAGES = ['/', '/privacy', '/terms', '/attribution', '/optout'];
const TOOL_PAGES = ['dev-card', 'compat', 'recruiter', 'fairness', 'gap', 'graveyard', 'oss', 'fyp-check'].map((tool) => `/tools/${tool}`);

test.describe('smoke @smoke', () => {
  test('the health route answers', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  test('public and tool pages render with one H1, a nonce policy and no serious accessibility violations', async ({ page }) => {
    for (const path of [...PUBLIC_PAGES, ...TOOL_PAGES]) {
      const response = await page.goto(path);
      expect(response?.status(), `status of ${path}`).toBe(200);
      expect(response?.headers()['content-security-policy'] ?? '', `policy on ${path}`).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      await expect(page.locator('h1'), `one H1 on ${path}`).toHaveCount(1);
      await expectNoSeriousA11yViolations(page, path);
    }
  });

  test('sign-in asks GitHub for the two read-only scopes and the members area needs it', async ({ request }) => {
    const signIn = await request.get('/auth/sign-in?next=/home', { maxRedirects: 0 });
    expect(signIn.status()).toBe(307);
    const authorize = new URL(signIn.headers().location ?? '');
    expect(authorize.searchParams.get('provider')).toBe('github');
    expect(authorize.searchParams.get('scopes')).toBe('read:user user:email');
    const home = await request.get('/home', { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(new URL(home.headers().location ?? '', 'http://placeholder.test').pathname).toBe('/auth/sign-in');
  });

  test('robots and the sitemap list public pages only', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap:');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/tools/dev-card');
    expect(sitemap).not.toMatch(/\/(admin|home|inbox|settings)\b/);
  });
});
