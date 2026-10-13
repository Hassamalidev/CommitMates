/**
 * License policy (CLAUDE.md §2.2). Every production dependency must carry a license
 * from the allow-list. SPDX expressions are evaluated: `A OR B` passes when either
 * side is allowed, `A AND B` only when both are.
 */

/** Code licenses, plus the font and asset licenses that npm packages may declare. */
export const ALLOWED_LICENSES: readonly string[] = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'CC-BY-4.0',
];

export type PackageLicense = { name: string; version: string; license: string };

export type LicenseException = {
  /** Package name the exception applies to. */
  name: string;
  /** The exact license string that was reviewed. A change re-triggers the check. */
  license: string;
  /** Where the review is recorded, e.g. an ADR. */
  reason: string;
};

type Token = { type: 'open' | 'close' | 'and' | 'or' | 'with' | 'id'; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  for (const part of expression.replace(/([()])/g, ' $1 ').split(/\s+/)) {
    if (part === '') continue;
    const upper = part.toUpperCase();
    if (part === '(') tokens.push({ type: 'open', value: part });
    else if (part === ')') tokens.push({ type: 'close', value: part });
    else if (upper === 'AND') tokens.push({ type: 'and', value: part });
    else if (upper === 'OR') tokens.push({ type: 'or', value: part });
    else if (upper === 'WITH') tokens.push({ type: 'with', value: part });
    else tokens.push({ type: 'id', value: part });
  }
  return tokens;
}

/**
 * Evaluates an SPDX license expression against an allow-list.
 * Anything that does not parse as SPDX (empty, "SEE LICENSE IN …", "UNLICENSED") is rejected.
 */
export function isLicenseAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  const tokens = tokenize(expression);
  let index = 0;
  let valid = tokens.length > 0;

  const peek = (): Token | undefined => tokens[index];
  const take = (): Token | undefined => tokens[index++];

  const parseFactor = (): boolean => {
    const token = take();
    if (!token) {
      valid = false;
      return false;
    }
    if (token.type === 'open') {
      const inner = parseExpression();
      if (take()?.type !== 'close') valid = false;
      return inner;
    }
    if (token.type !== 'id') {
      valid = false;
      return false;
    }
    if (peek()?.type === 'with') {
      // An exception clause changes the terms; none are on the allow-list.
      take();
      if (take()?.type !== 'id') valid = false;
      return false;
    }
    return allowed.has(token.value);
  };

  const parseTerm = (): boolean => {
    let result = parseFactor();
    while (peek()?.type === 'and') {
      take();
      const right = parseFactor();
      result = result && right;
    }
    return result;
  };

  function parseExpression(): boolean {
    let result = parseTerm();
    while (peek()?.type === 'or') {
      take();
      const right = parseTerm();
      result = result || right;
    }
    return result;
  }

  const result = parseExpression();
  return valid && index === tokens.length && result;
}

export function findLicenseViolations(
  packages: readonly PackageLicense[],
  allowed: readonly string[] = ALLOWED_LICENSES,
  exceptions: readonly LicenseException[] = [],
): PackageLicense[] {
  const allowedSet = new Set(allowed);
  return packages.filter((pkg) => {
    if (isLicenseAllowed(pkg.license, allowedSet)) return false;
    return !exceptions.some((exception) => exception.name === pkg.name && exception.license === pkg.license);
  });
}

type PnpmLicenseEntry = { name?: unknown; versions?: unknown; version?: unknown; license?: unknown };

/** Flattens `pnpm licenses list --json` (license → packages) into one row per package version. */
export function parsePnpmLicenses(json: unknown): PackageLicense[] {
  if (typeof json !== 'object' || json === null) throw new Error('Unexpected output from pnpm licenses');
  const rows: PackageLicense[] = [];
  for (const [license, entries] of Object.entries(json)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as PnpmLicenseEntry[]) {
      if (typeof entry.name !== 'string') continue;
      const versions = Array.isArray(entry.versions) ? entry.versions : [entry.version];
      for (const version of versions) {
        rows.push({
          name: entry.name,
          version: typeof version === 'string' ? version : 'unknown',
          license: typeof entry.license === 'string' ? entry.license : license,
        });
      }
    }
  }
  return rows;
}

export function formatLicenseViolation(pkg: PackageLicense): string {
  return `${pkg.name}@${pkg.version}  license "${pkg.license}" is not on the allow-list`;
}
