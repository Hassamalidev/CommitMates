import { RateLimitError } from '@commitmates/db';
import { describe, expect, it } from 'vitest';

import { GitHubForbiddenError, GitHubNotFoundError, GitHubServerError, unlessUnreadable } from './errors';

describe('unlessUnreadable', () => {
  it('passes a value through', async () => {
    expect(await unlessUnreadable(Promise.resolve(3))).toBe(3);
  });

  it('turns a blocked or missing resource into null', async () => {
    expect(await unlessUnreadable(Promise.reject(new GitHubForbiddenError()))).toBeNull();
    expect(await unlessUnreadable(Promise.reject(new GitHubNotFoundError('that')))).toBeNull();
  });

  it('lets rate limits and server errors through, so the job waits or retries', async () => {
    await expect(unlessUnreadable(Promise.reject(new RateLimitError(new Date())))).rejects.toBeInstanceOf(RateLimitError);
    await expect(unlessUnreadable(Promise.reject(new GitHubServerError('502')))).rejects.toBeInstanceOf(GitHubServerError);
  });
});
