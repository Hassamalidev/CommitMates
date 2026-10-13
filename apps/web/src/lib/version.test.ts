import { describe, expect, it } from 'vitest';

import { getAppVersion } from './version';

describe('getAppVersion', () => {
  it('reads the package version', () => {
    expect(getAppVersion({}).version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(getAppVersion({}).commit).toBeNull();
  });

  it('abbreviates the deployed commit', () => {
    expect(getAppVersion({ VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' }).commit).toBe('0123456');
    expect(getAppVersion({ GIT_COMMIT_SHA: 'fedcba9876543210' }).commit).toBe('fedcba9');
  });
});
