import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, createNonce } from './csp';

const directives = (policy: string) => new Map(policy.split('; ').map((part) => [part.split(' ')[0], part.split(' ').slice(1)]));

describe('contentSecurityPolicy', () => {
  it('allows scripts only from our origin or with the nonce, and connections only to us and Supabase', () => {
    const policy = directives(contentSecurityPolicy({ nonce: 'abc123', supabaseUrl: 'https://project.supabase.co', development: false }));
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://project.supabase.co', 'wss://project.supabase.co']);
    expect(policy.get('img-src')).toEqual(["'self'", 'https://avatars.githubusercontent.com', 'data:', 'blob:']);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect([...policy.values()].flat()).not.toContain("'unsafe-eval'");
  });

  it('adds what the development server needs, and the plain websocket of a local Supabase', () => {
    const policy = directives(contentSecurityPolicy({ nonce: 'n', supabaseUrl: 'http://127.0.0.1:54321', development: true }));
    expect(policy.get('script-src')).toContain("'unsafe-eval'");
    expect(policy.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:54321', 'ws://127.0.0.1:54321', 'ws:']);
  });
});

describe('createNonce', () => {
  it('makes a different 128-bit base64 value each time', () => {
    const [a, b] = [createNonce(), createNonce()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
