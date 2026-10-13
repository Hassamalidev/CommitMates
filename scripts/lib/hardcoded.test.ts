import { describe, expect, it } from 'vitest';

import { findHardcoded, formatHardcodedFinding, isCheckedFile } from './hardcoded';

const check = (source: string) => findHardcoded('packages/core/src/sample.ts', source);

describe('findHardcoded', () => {
  it('flags numbers greater than 1', () => {
    const findings = check('export function f(x: number) {\n  return x > 500 ? 0.3 : 1;\n}\n');
    expect(findings).toEqual([expect.objectContaining({ kind: 'number', text: '500', line: 2 })]);
  });

  it('flags string arrays of three or more items', () => {
    const findings = check("export const terms = ['todo', 'wip', 'coming soon'];\nexport const two = ['a', 'b'];\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'string-array', line: 1 });
  });

  it('accepts a documented constant, including nested values', () => {
    const source = [
      '/** Milliseconds in a day. */',
      'const MS_PER_DAY = 24 * 60 * 60 * 1000;',
      '// Job priority classes (CLAUDE.md §5.4).',
      'export const PRIORITY = { INTERACTIVE: 100, USER_BG: 50 } as const;',
      'export const day = MS_PER_DAY;',
    ].join('\n');
    expect(check(source)).toEqual([]);
  });

  it('rejects an undocumented or lower-case constant', () => {
    expect(check('const MS_PER_DAY = 86400000;\nexport const d = MS_PER_DAY;\n')).toHaveLength(1);
    expect(check('/** documented */\nconst limit = 30;\nexport const l = limit;\n')).toHaveLength(1);
  });

  it('does not let a constant excuse literals inside a function body', () => {
    const source = '/** Handler. */\nexport const HANDLER = () => {\n  return 42;\n};\n';
    expect(check(source)).toHaveLength(1);
  });

  it('accepts an allowed-literal comment on the same line or the line above', () => {
    const source = [
      'export function freshness(ageDays: number) {',
      '  return Math.exp(-ageDays / 30); // allowed-literal: monthly half-life',
      '}',
      '// allowed-literal: sprite design',
      "export const ears = ['none', 'pointy', 'round'];",
    ].join('\n');
    expect(check(source)).toEqual([]);
  });

  it('requires a reason after allowed-literal', () => {
    expect(check('export const x = 30; // allowed-literal:\n')).toHaveLength(1);
  });

  it('ignores literal types and enums', () => {
    const source = "export type Stage = 0 | 1 | 2 | 3 | 4;\nexport type S = 'a' | 'b' | 'c';\nenum E {\n  A = 5,\n}\nexport const e = E.A;\n";
    expect(check(source)).toEqual([]);
  });

  it('parses TSX', () => {
    const findings = findHardcoded('packages/core/src/x.tsx', 'export const C = () => <div tabIndex={3} />;\n');
    expect(findings).toHaveLength(1);
  });
});

describe('isCheckedFile', () => {
  it('skips tests, fixtures and declarations', () => {
    expect(isCheckedFile('packages/core/src/fyp/service.ts')).toBe(true);
    expect(isCheckedFile('packages/core/src/fyp/service.test.ts')).toBe(false);
    expect(isCheckedFile('packages/core/src/__fixtures__/data.ts')).toBe(false);
    expect(isCheckedFile('packages/core/src/__tests__/helper.ts')).toBe(false);
    expect(isCheckedFile('packages/core/src/types.d.ts')).toBe(false);
    expect(isCheckedFile('packages/core/README.md')).toBe(false);
  });
});

describe('formatHardcodedFinding', () => {
  it('prints a clickable location', () => {
    const [finding] = check('export const x = 30;\n');
    expect(finding && formatHardcodedFinding(finding)).toBe(
      'packages/core/src/sample.ts:1:18  unexplained number literal: 30',
    );
  });
});
