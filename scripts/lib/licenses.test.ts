import { describe, expect, it } from 'vitest';

import {
  ALLOWED_LICENSES,
  findLicenseViolations,
  formatLicenseViolation,
  isLicenseAllowed,
  parsePnpmLicenses,
} from './licenses';

const allowed = new Set(ALLOWED_LICENSES);

describe('isLicenseAllowed', () => {
  it('accepts allow-listed identifiers', () => {
    for (const license of ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', '0BSD', 'MPL-2.0']) {
      expect(isLicenseAllowed(license, allowed)).toBe(true);
    }
  });

  it('rejects copyleft and source-available licenses', () => {
    for (const license of ['GPL-3.0', 'GPL-2.0-or-later', 'AGPL-3.0-only', 'SSPL-1.0', 'BUSL-1.1', 'LGPL-3.0']) {
      expect(isLicenseAllowed(license, allowed)).toBe(false);
    }
  });

  it('passes OR when either side is allowed', () => {
    expect(isLicenseAllowed('(MIT OR GPL-3.0)', allowed)).toBe(true);
    expect(isLicenseAllowed('GPL-2.0 OR AGPL-3.0', allowed)).toBe(false);
  });

  it('passes AND only when both sides are allowed', () => {
    expect(isLicenseAllowed('MIT AND ISC', allowed)).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-3.0', allowed)).toBe(false);
  });

  it('honors precedence and parentheses', () => {
    expect(isLicenseAllowed('GPL-3.0 OR MIT AND ISC', allowed)).toBe(true);
    expect(isLicenseAllowed('(GPL-3.0 OR MIT) AND AGPL-3.0', allowed)).toBe(false);
    expect(isLicenseAllowed('(MIT AND (ISC OR GPL-3.0))', allowed)).toBe(true);
  });

  it('rejects exception clauses and anything that is not SPDX', () => {
    expect(isLicenseAllowed('Apache-2.0 WITH LLVM-exception', allowed)).toBe(false);
    expect(isLicenseAllowed('', allowed)).toBe(false);
    expect(isLicenseAllowed('UNLICENSED', allowed)).toBe(false);
    expect(isLicenseAllowed('SEE LICENSE IN LICENSE.txt', allowed)).toBe(false);
    expect(isLicenseAllowed('MIT OR', allowed)).toBe(false);
    expect(isLicenseAllowed('(MIT', allowed)).toBe(false);
    expect(isLicenseAllowed('MIT ISC', allowed)).toBe(false);
  });
});

describe('findLicenseViolations', () => {
  const packages = [
    { name: 'zod', version: '4.0.0', license: 'MIT' },
    { name: 'copyleft-lib', version: '1.0.0', license: 'AGPL-3.0' },
    { name: 'odd-lib', version: '2.0.0', license: 'BlueOak-1.0.0' },
  ];

  it('reports packages outside the allow-list', () => {
    expect(findLicenseViolations(packages).map((pkg) => pkg.name)).toEqual(['copyleft-lib', 'odd-lib']);
  });

  it('honors a reviewed exception only for the exact license string', () => {
    const exception = { name: 'odd-lib', license: 'BlueOak-1.0.0', reason: 'ADR-001' };
    expect(findLicenseViolations(packages, ALLOWED_LICENSES, [exception]).map((pkg) => pkg.name)).toEqual([
      'copyleft-lib',
    ]);
    const relicensed = [{ name: 'odd-lib', version: '3.0.0', license: 'GPL-3.0' }];
    expect(findLicenseViolations(relicensed, ALLOWED_LICENSES, [exception])).toHaveLength(1);
  });
});

describe('parsePnpmLicenses', () => {
  it('flattens the license map into one row per version', () => {
    const rows = parsePnpmLicenses({
      MIT: [{ name: 'a', versions: ['1.0.0', '2.0.0'], license: 'MIT' }],
      ISC: [{ name: 'b', version: '3.0.0' }],
    });
    expect(rows).toEqual([
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'a', version: '2.0.0', license: 'MIT' },
      { name: 'b', version: '3.0.0', license: 'ISC' },
    ]);
  });

  it('rejects unexpected output', () => {
    expect(() => parsePnpmLicenses('nope')).toThrow();
  });
});

describe('formatLicenseViolation', () => {
  it('names the package and its license', () => {
    expect(formatLicenseViolation({ name: 'x', version: '1.2.3', license: 'GPL-3.0' })).toContain('x@1.2.3');
  });
});
