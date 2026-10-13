import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { signInTestMember } from './helpers/session';

test.describe('authentication', () => {
  test('a signed-out visitor is sent to sign-in from the members area', async ({ request }) => {
    const response = await request.get('/home', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location ?? '', 'http://placeholder.test');
    expect(location.pathname).toBe('/auth/sign-in');
    expect(location.searchParams.get('next')).toBe('/home');
  });

  test('sign-in starts GitHub OAuth with the two read-only scopes', async ({ request }) => {
    const response = await request.get('/auth/sign-in?next=/home', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const authorize = new URL(response.headers().location ?? '');
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('github');
    expect(authorize.searchParams.get('scopes')).toBe('read:user user:email');
    expect(authorize.searchParams.get('redirect_to')).toContain('/auth/callback?next=%2Fhome');
  });

  test('the callback rejects a request without a code', async ({ request }) => {
    const response = await request.get('/auth/callback', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain('auth_error=sign_in');
  });

  test('sign-out refuses cross-site posts', async ({ request }) => {
    const response = await request.post('/auth/sign-out', {
      headers: { origin: 'https://evil.example' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });

  test('a member sees their session and can sign out', async ({ page, context, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    try {
      await page.goto('/');
      await expect(page.getByTestId('auth-status')).toContainText(`Signed in`);
      await expectNoSeriousA11yViolations(page);

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
      await expect(page.getByTestId('auth-status')).toHaveCount(0);
    } finally {
      await member.cleanup();
    }
  });
});
