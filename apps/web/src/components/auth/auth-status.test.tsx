// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasSessionCookie } from '@/lib/session-cookie';

import { AuthStatus } from './AuthStatus';

type Session = { access_token?: string; user: { id?: string; user_metadata: Record<string, unknown> } };
const getSession = vi.fn<() => Promise<{ data: { session: Session | null } }>>();
let onInsert: (() => void) | null = null;
const channel = {
  on: (_event: string, _filter: unknown, handler: () => void) => {
    onInsert = handler;
    return channel;
  },
  subscribe: () => channel,
};
const createSupabaseBrowserClient = vi.fn(() => ({
  auth: { getSession },
  realtime: { setAuth: vi.fn() },
  channel: () => channel,
  removeChannel: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient }));
const { notificationBadgeAction } = vi.hoisted(() => ({ notificationBadgeAction: vi.fn<() => Promise<{ ok: true; data: number }>>() }));
vi.mock('@/server/actions/notifications', () => ({ notificationBadgeAction }));
vi.mock('next/navigation', () => ({ usePathname: () => '/home' }));

const setCookie = (value: string) => {
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => value });
};

afterEach(() => {
  cleanup();
  onInsert = null;
  notificationBadgeAction.mockReset();
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
    getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'user-1', user_metadata: { user_name: 'ada' } } } } });
    notificationBadgeAction.mockResolvedValue({ ok: true, data: 0 });
    render(<AuthStatus />);
    await waitFor(() => {
      expect(screen.getByTestId('auth-status').textContent).toContain('ada');
    });
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('shows the unread count and reads it again when a notification arrives', async () => {
    setCookie('sb-abc-auth-token=xyz');
    getSession.mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'user-1', user_metadata: { user_name: 'ada' } } } } });
    notificationBadgeAction.mockResolvedValueOnce({ ok: true, data: 2 }).mockResolvedValue({ ok: true, data: 3 });
    render(<AuthStatus />);
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy();
    await waitFor(() => {
      expect(onInsert).not.toBeNull();
    });
    onInsert?.();
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy();
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
