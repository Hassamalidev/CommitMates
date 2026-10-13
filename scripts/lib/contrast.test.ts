import { describe, expect, it } from 'vitest';

import {
  AA_TEXT,
  AA_UI,
  CONTRAST_RULES,
  checkContrast,
  contrastRatio,
  formatContrastFailure,
  parseHex,
  parseTokens,
  relativeLuminance,
  resolveToken,
} from './contrast';

describe('parseHex', () => {
  it('reads six- and three-digit colors', () => {
    expect(parseHex('#0D0F14')).toEqual([13, 15, 20]);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });

  it('rejects anything else', () => {
    expect(() => parseHex('rgb(0,0,0)')).toThrow('Not a hex color');
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
    expect(contrastRatio(parseHex('#000000'), parseHex('#FFFFFF'))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex('#777777'), parseHex('#FFFFFF'))).toBeCloseTo(4.48, 2);
    expect(contrastRatio(parseHex('#767676'), parseHex('#FFFFFF'))).toBeCloseTo(4.54, 2);
  });

  it('is symmetric', () => {
    const a = parseHex('#7CFF6B');
    const b = parseHex('#0D0F14');
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });
});

const css = `
/* tokens */
:root[data-theme="dark"] {
  --bg: #0D0F14;
  --text: #E8ECF4;
  --accent: #7CFF6B;
  --focus: var(--accent);
}
:root[data-theme='light'] {
  --bg: #FFFFFF;
  --text: #777777; /* deliberately too light */
  --accent: #1F8F3A;
  --focus: var(--accent);
}
`;

describe('parseTokens', () => {
  it('reads each theme block', () => {
    const themes = parseTokens(css);
    expect(Object.keys(themes)).toEqual(['dark', 'light']);
    expect(themes.dark).toMatchObject({ '--bg': '#0D0F14', '--focus': 'var(--accent)' });
  });
});

describe('resolveToken', () => {
  it('follows var() references', () => {
    expect(resolveToken({ '--a': 'var(--b)', '--b': '#123456' }, '--a')).toBe('#123456');
  });

  it('reports undefined tokens and cycles', () => {
    expect(() => resolveToken({}, '--a')).toThrow('not defined');
    expect(() => resolveToken({ '--a': 'var(--b)', '--b': 'var(--a)' }, '--a')).toThrow('circular');
  });
});

describe('checkContrast', () => {
  const rules = [
    { foreground: '--text', background: '--bg', min: AA_TEXT, use: 'text' },
    { foreground: '--focus', background: '--bg', min: AA_UI, use: 'focus ring' },
  ];

  it('fails only the pair below its minimum', () => {
    const failures = checkContrast(parseTokens(css), rules);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ theme: 'light', foreground: '--text', background: '--bg' });
    expect(failures[0] && formatContrastFailure(failures[0])).toBe(
      '[light] --text on --bg: 4.48:1, needs 4.5:1 (text)',
    );
  });

  it('passes when every pair is compliant', () => {
    expect(checkContrast(parseTokens(css.replace('#777777', '#151923')), rules)).toEqual([]);
  });
});

describe('CONTRAST_RULES', () => {
  it('covers text on every surface and text on the accent', () => {
    const pairs = CONTRAST_RULES.map((rule) => `${rule.foreground}/${rule.background}`);
    expect(pairs).toEqual(
      expect.arrayContaining(['--text/--bg', '--text-muted/--surface-2', '--accent-ink/--accent', '--focus/--surface']),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
