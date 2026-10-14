import { describe, expect, it } from 'vitest';

import { formatUtc, previewJson } from './format';

describe('formatUtc', () => {
  it('formats to the minute in UTC', () => {
    expect(formatUtc(new Date('2026-10-14T12:34:56.789Z'))).toBe('2026-10-14 12:34');
    expect(formatUtc(null)).toBeNull();
    expect(formatUtc(undefined)).toBeNull();
  });
});

describe('previewJson', () => {
  it('renders scalars and truncates long values', () => {
    expect(previewJson(30)).toBe('30');
    expect(previewJson('a')).toBe('"a"');
    expect(previewJson(null)).toBe('null');
    const long = previewJson(Array.from({ length: 40 }, (_, index) => `term-${index}`));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
