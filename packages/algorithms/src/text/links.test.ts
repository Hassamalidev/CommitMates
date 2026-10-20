import { describe, expect, it } from 'vitest';

import { countLinks, findLinks } from './links';

describe('links', () => {
  it('finds http, https and bare www links', () => {
    expect(findLinks('See https://github.com/a/b and http://x.dev/y, or www.example.org.')).toEqual([
      'https://github.com/a/b',
      'http://x.dev/y,',
      'www.example.org.',
    ]);
  });

  it('counts nothing in plain text, emails or partial schemes', () => {
    expect(countLinks('')).toBe(0);
    expect(countLinks('mail me at someone@example.com about http and https')).toBe(0);
    expect(countLinks('ftp://old.example.org')).toBe(0);
  });

  it('is case-insensitive and stops at whitespace', () => {
    expect(countLinks('HTTPS://A.DEV\nWWW.B.DEV\thttps://c.dev')).toBe(3);
  });
});
