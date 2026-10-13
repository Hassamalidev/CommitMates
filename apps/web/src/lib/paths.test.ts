import { describe, expect, it } from 'vitest';

import { isProtectedPath, safeNextPath } from './paths';

describe('isProtectedPath', () => {
  it('protects the members area and admin', () => {
    expect(isProtectedPath('/home')).toBe(true);
    expect(isProtectedPath('/settings/privacy')).toBe(true);
    expect(isProtectedPath('/admin/jobs')).toBe(true);
  });

  it('leaves public pages alone', () => {
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/tools/dev-card')).toBe(false);
    expect(isProtectedPath('/health')).toBe(false);
    expect(isProtectedPath('/homepage')).toBe(false);
    expect(isProtectedPath('/u/octocat')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('accepts same-site paths', () => {
    expect(safeNextPath('/home')).toBe('/home');
    expect(safeNextPath('/inbox/123?tab=requests')).toBe('/inbox/123?tab=requests');
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'home',
    '/%2f%2fevil.example',
    '/a\nb',
  ])('falls back for %j', (value) => {
    expect(safeNextPath(value, '/fallback')).toBe('/fallback');
  });
});
