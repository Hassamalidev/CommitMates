import { describe, expect, it } from 'vitest';

import { normalizeName } from './names';

describe('normalizeName', () => {
  it('folds case, accents, punctuation and spacing', () => {
    expect(normalizeName('  Computer Science & Engineering ')).toBe('computer science engineering');
    expect(normalizeName('computer-science   engineering')).toBe('computer science engineering');
    expect(normalizeName('Génie Électrique')).toBe('genie electrique');
    expect(normalizeName('数学系')).toBe('数学系');
    expect(normalizeName('!!!')).toBe('');
  });
});
