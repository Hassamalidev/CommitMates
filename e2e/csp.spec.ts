import { expect, test, type Page } from '@playwright/test';

import { prepareMember } from './helpers/members';
import { signInTestMember } from './helpers/session';

/** Collects every Content-Security-Policy violation the page reports. */
function watchViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

test.describe('content security policy (P7-T01b)', () => {
  test('public pages carry a per-request nonce policy and run without violations', async ({ page }) => {
    const violations = watchViolations(page);
    const first = await page.goto('/');
    const second = await page.request.get('/');
    const policy = first?.headers()['content-security-policy'] ?? '';
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    // A different nonce on every request.
    expect(second.headers()['content-security-policy']).not.toBe(policy);
    // Client code hydrated and runs: the theme toggle works.
    await page.getByRole('button', { name: 'System theme' }).click();
    await expect(page.getByRole('button', { name: 'Light theme' })).toBeVisible();
    await page.goto('/tools/dev-card');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('members pages run under the policy too', async ({ page, context, baseURL }) => {
    const violations = watchViolations(page);
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await prepareMember(member, { verifiedDaysAgo: null });
      await page.goto('/onboarding');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.goto('/settings/privacy');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(violations).toEqual([]);
    } finally {
      await member.cleanup();
    }
  });
});
