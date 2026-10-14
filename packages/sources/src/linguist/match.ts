import { compileRe2, re2Matches, type RE2JS } from './regex';

export type PathPattern = { kind: 'vendored' | 'documentation'; pattern: string; compiledOk: boolean };

export type PathMatcher = {
  isVendored(path: string): boolean;
  isDocumentation(path: string): boolean;
};

/**
 * Builds a matcher from synced Linguist path rules. Patterns marked as not compilable
 * are ignored. Paths are matched as repository-relative, with forward slashes.
 */
export function createPathMatcher(patterns: readonly PathPattern[]): PathMatcher {
  const compiled: Record<PathPattern['kind'], RE2JS[]> = { vendored: [], documentation: [] };
  for (const { kind, pattern, compiledOk } of patterns) {
    if (!compiledOk) continue;
    const regex = compileRe2(pattern);
    if (regex) compiled[kind].push(regex);
  }
  const matches = (kind: PathPattern['kind'], path: string) => {
    const normalized = path.replace(/^\/+/, '');
    return compiled[kind].some((regex) => re2Matches(regex, normalized));
  };
  return {
    isVendored: (path) => matches('vendored', path),
    isDocumentation: (path) => matches('documentation', path),
  };
}
