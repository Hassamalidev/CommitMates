import { describe, expect, it } from 'vitest';

import { markdownExcerpt, markdownToText } from './markdown';

const README = [
  '# Campus Navigator',
  '',
  '[![Build](https://img.shields.io/badge/build-passing-green)](https://ci.example) <img src="logo.png">',
  '',
  'A **mobile app** that finds _empty_ study rooms. See the [docs](https://example.com/docs) or the [wiki][w].',
  '',
  '```bash',
  'npm install',
  '```',
  '',
  '> Built for our final year.',
  '- Live maps',
  '1. Offline mode',
  '',
  '---',
  '[w]: https://example.com/wiki',
  '<!-- hidden -->',
  'Run `make` to build.',
].join('\n');

describe('markdownToText', () => {
  it('keeps the words and drops code, markup, images, link targets and markers', () => {
    expect(markdownToText(README)).toBe(
      ['Campus Navigator', 'A mobile app that finds empty study rooms. See the docs or the wiki.', 'Built for our final year. Live maps Offline mode', 'Run make to build.'].join('\n\n'),
    );
  });

  it('turns script-like HTML into nothing and handles empty input', () => {
    expect(markdownToText('<script>alert(1)</script>Hello')).toBe('alert(1)Hello');
    expect(markdownToText('')).toBe('');
    expect(markdownToText('Set my_var_name and __init__ but _stress_ this.')).toBe('Set my_var_name and init but stress this.');
  });
});

describe('markdownExcerpt', () => {
  it('returns short text whole and cuts long text at a word boundary with an ellipsis', () => {
    expect(markdownExcerpt('Short readme.', 50)).toBe('Short readme.');
    const cut = markdownExcerpt('one two three four five six', 15);
    expect(cut).toBe('one two three…');
    expect(cut.length).toBeLessThanOrEqual(15);
    expect(markdownExcerpt('abcdefghijklmnop', 5)).toBe('abcd…');
  });
});
