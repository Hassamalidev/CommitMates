import { describe, expect, it, vi } from 'vitest';

vi.mock('@commitmates/env/client', () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: 'https://commitmates.example' } }));

const { isSameOrigin, siteOrigin } = await import('./origin');

const post = (headers: Record<string, string>) =>
  new Request('http://internal:3000/auth/sign-out', { method: 'POST', headers });

describe('isSameOrigin', () => {
  it('reads the site origin from configuration', () => {
    expect(siteOrigin()).toBe('https://commitmates.example');
  });

  it('accepts the configured site', () => {
    expect(isSameOrigin(post({ origin: 'https://commitmates.example' }))).toBe(true);
  });

  it('accepts an origin that matches the host the request was sent to', () => {
    expect(isSameOrigin(post({ origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' }))).toBe(true);
    expect(
      isSameOrigin(post({ origin: 'https://preview.example', host: 'internal:3000', 'x-forwarded-host': 'preview.example' })),
    ).toBe(true);
  });

  it('rejects other sites, missing and malformed origins', () => {
    expect(isSameOrigin(post({ origin: 'https://evil.example', host: 'commitmates.example' }))).toBe(false);
    expect(isSameOrigin(post({ host: 'commitmates.example' }))).toBe(false);
    expect(isSameOrigin(post({ origin: 'null', host: 'commitmates.example' }))).toBe(false);
    expect(isSameOrigin(post({ origin: 'https://commitmates.example.evil.example', host: 'commitmates.example' }))).toBe(
      false,
    );
  });
});
