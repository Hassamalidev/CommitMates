import { RE2JS } from 're2js';

/**
 * Compiles an upstream pattern with RE2, which guarantees linear-time matching on
 * untrusted input. Returns `null` for patterns RE2 cannot express (look-arounds,
 * backreferences); callers skip those and count them (CLAUDE.md §6.3, §6.7).
 */
export function compileRe2(pattern: string, flags = 0): RE2JS | null {
  try {
    return RE2JS.compile(pattern, flags);
  } catch {
    return null;
  }
}

export function re2Matches(compiled: RE2JS, input: string): boolean {
  return compiled.matcher(input).find();
}

export { RE2JS };
