import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_FALLBACKS, publicSiteName } from './public';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publicSiteName', () => {
  it('reads the site name and falls back when it is missing or empty', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_NAME', 'CampusCode');
    expect(publicSiteName()).toBe('CampusCode');
    vi.stubEnv('NEXT_PUBLIC_SITE_NAME', '');
    expect(publicSiteName()).toBe(CLIENT_FALLBACKS.NEXT_PUBLIC_SITE_NAME);
    vi.stubEnv('NEXT_PUBLIC_SITE_NAME', undefined);
    expect(publicSiteName()).toBe(CLIENT_FALLBACKS.NEXT_PUBLIC_SITE_NAME);
  });
});
