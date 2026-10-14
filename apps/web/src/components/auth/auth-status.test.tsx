// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasSessionCookie } from '@/lib/session-cookie';

import { AuthStatus } from './AuthStatus';

const getSession = vi.fn<() => Promise<{ data: { session: { user: { user_metadata: Record<string, unknown> } } | null } }>>();
const createSupabaseBrowserClient = vi.fn(() => ({ auth: { getSession } }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient }));

const setCookie = (value: string) => {
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => value });
};

afterEach(() => {
  cleanup();
  getSession.mockReset();
  createSupabaseBrowserClient.mockClear();
  setCookie('');
});

describe('hasSessionCookie', () => {
  it('finds whole and chunked Supabase auth cookies only', () => {
    expect(hasSessionCookie('theme=dark; sb-abc-auth-token=xyz')).toBe(true);
    expect(hasSessionCookie('sb-127-auth-token.0=a; sb-127-auth-token.1=b')).toBe(true);
    expect(hasSessionCookie('theme=dark; sb-abc-auth-token-code-verifier=x')).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
  });
});

describe('AuthStatus', () => {
  it('shows visitors the sign-in link without loading the Supabase client', async () => {
    setCookie('theme=dark');
    render(<AuthStatus />);
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' }).getAttribute('href')).toBe('/auth/sign-in');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createSupabaseBrowserClient).not.toHaveBeenCalled();
  });

  it("replaces the link with the member's login and a sign-out button", async () => {
    setCookie('sb-abc-auth-token=xyz');
    getSession.mockResolvedValue({ data: { session: { user: { user_metadata: { user_name: 'ada' } } } } });
    render(<AuthStatus />);
    await waitFor(() => {
      expect(screen.getByTestId('auth-status').textContent).toContain('ada');
    });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('keeps the sign-in link when the cookie holds no session', async () => {
    setCookie('sb-abc-auth-token=expired');
    getSession.mockResolvedValue({ data: { session: null } });
    render(<AuthStatus />);
    await waitFor(() => {
      expect(getSession).toHaveBeenCalled();
    });
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' })).toBeTruthy();
  });
});
