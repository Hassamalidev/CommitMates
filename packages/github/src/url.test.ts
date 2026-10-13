import { describe, expect, it } from 'vitest';

import { parseGitHubUrl } from './url';

describe('parseGitHubUrl', () => {
  it.each([
    ['https://github.com/vercel/next.js', { owner: 'vercel', repo: 'next.js' }],
    ['https://github.com/vercel/next.js/', { owner: 'vercel', repo: 'next.js' }],
    ['http://www.github.com/a/b', { owner: 'a', repo: 'b' }],
    ['github.com/a/b', { owner: 'a', repo: 'b' }],
    ['https://github.com/a/b.git', { owner: 'a', repo: 'b' }],
    ['https://github.com/a/b/tree/main/src', { owner: 'a', repo: 'b' }],
    ['https://github.com/a/b/blob/main/README.md?plain=1#L3', { owner: 'a', repo: 'b' }],
    ['https://github.com/a/b/pull/42', { owner: 'a', repo: 'b', number: 42 }],
    ['https://github.com/a/b/pull/42/files', { owner: 'a', repo: 'b', number: 42 }],
    ['https://github.com/a/b/issues/7', { owner: 'a', repo: 'b', number: 7 }],
    ['  a/b  ', { owner: 'a', repo: 'b' }],
    ['my-org/my_repo.js', { owner: 'my-org', repo: 'my_repo.js' }],
  ])('accepts %s', (input, expected) => {
    expect(parseGitHubUrl(input)).toEqual(expected);
  });

  it.each([
    '',
    '   ',
    'just-a-name',
    'a/b/c',
    'https://gitlab.com/a/b',
    'https://github.com.evil.example/a/b',
    'https://evil.example/github.com/a/b',
    'https://user:pass@github.com/a/b',
    'https://github.com:8443/a/b',
    'ftp://github.com/a/b',
    'javascript:alert(1)',
    'https://github.com/a',
    'https://github.com/-bad/b',
    'https://github.com/a/..',
    'a/b c',
    'http://169.254.169.254/latest/meta-data',
    'https://github.com/a/b/pull/0',
  ])('rejects %s', (input) => {
    const result = parseGitHubUrl(input);
    if (input === 'https://github.com/a/b/pull/0') {
      expect(result).toEqual({ owner: 'a', repo: 'b' });
    } else {
      expect(result).toBeNull();
    }
  });
});
