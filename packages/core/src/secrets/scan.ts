import { shannonEntropy } from '@commitmates/algorithms';
import type { SecretAllowlist } from '@commitmates/db';

import { compileRe2, re2Matches, type RE2JS } from '@commitmates/sources';

/** A rule ready to run: patterns compiled once per scan. */
export type CompiledRule = {
  id: string;
  keywords: readonly string[];
  regex: RE2JS | null;
  pathRegex: RE2JS | null;
  entropy: number | null;
  secretGroup: number;
  allowlists: CompiledAllowlist[];
};

type CompiledAllowlist = {
  condition: 'OR' | 'AND';
  regexTarget: SecretAllowlist['regexTarget'];
  regexes: RE2JS[];
  paths: RE2JS[];
  stopwords: readonly string[];
};

export type RuleSource = {
  id: string;
  regex: string | null;
  keywords: readonly string[];
  entropy: number | null;
  secretGroup: number;
  pathRegex: string | null;
  allowlists: readonly SecretAllowlist[];
  compiledOk: boolean;
};

/** Where a secret was found. The value itself is never part of a finding (CLAUDE.md §2.6). */
export type SecretFinding = { ruleId: string; path: string; line: number };

const compileAll = (patterns: readonly string[]) => patterns.flatMap((pattern) => compileRe2(pattern) ?? []);

function compileAllowlist(list: SecretAllowlist): CompiledAllowlist {
  return {
    condition: list.condition,
    regexTarget: list.regexTarget,
    regexes: compileAll(list.regexes),
    paths: compileAll(list.paths),
    stopwords: list.stopwords,
  };
}

/** Compiles the usable rules; rules RE2 could not compile at sync time are left out. */
export function compileRules(rules: readonly RuleSource[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.compiledOk)
    .map((rule) => ({
      id: rule.id,
      keywords: rule.keywords,
      regex: rule.regex === null ? null : compileRe2(rule.regex),
      pathRegex: rule.pathRegex === null ? null : compileRe2(rule.pathRegex),
      entropy: rule.entropy,
      secretGroup: rule.secretGroup,
      allowlists: rule.allowlists.map(compileAllowlist),
    }))
    .filter((rule) => rule.regex !== null || rule.pathRegex !== null);
}

export type CompiledGlobalAllowlist = CompiledAllowlist;

export const compileGlobalAllowlist = (list: SecretAllowlist): CompiledGlobalAllowlist => compileAllowlist(list);

/** True when gitleaks' global allowlist excludes the whole file. */
export const isAllowlistedPath = (path: string, global: CompiledGlobalAllowlist): boolean =>
  global.paths.some((pattern) => re2Matches(pattern, path));

type Candidate = { secret: string; match: string; line: string; path: string };

function allowed(list: CompiledAllowlist, candidate: Candidate): boolean {
  const target = list.regexTarget === 'match' ? candidate.match : list.regexTarget === 'line' ? candidate.line : candidate.secret;
  const lowered = candidate.secret.toLowerCase();
  const checks: boolean[] = [];
  if (list.regexes.length > 0) checks.push(list.regexes.some((pattern) => re2Matches(pattern, target)));
  if (list.paths.length > 0) checks.push(list.paths.some((pattern) => re2Matches(pattern, candidate.path)));
  if (list.stopwords.length > 0) checks.push(list.stopwords.some((word) => lowered.includes(word)));
  if (checks.length === 0) return false;
  return list.condition === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
}

/** The line (1-based) a character offset falls on. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) line += 1;
  return line;
}

function lineText(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return text.slice(start, end === -1 ? text.length : end);
}

/** The part of a match that is the secret: the rule's group, else the first non-empty group, else the whole match. */
function secretOf(matcher: ReturnType<RE2JS['matcher']>, secretGroup: number): string {
  const groups = matcher.groupCount();
  if (secretGroup > 0 && secretGroup <= groups) return matcher.group(secretGroup) ?? '';
  for (let group = 1; group <= groups; group += 1) {
    const value = matcher.group(group);
    if (value) return value;
  }
  return matcher.group() ?? '';
}

/**
 * Scans one file the way gitleaks does (CLAUDE.md §6.7): global path allowlist, the rule's
 * path condition, keyword prefilter, regex, entropy, then the rule's and the global
 * allowlists. Returns where secrets are, never what they are.
 */
export function scanFile(path: string, text: string, rules: readonly CompiledRule[], global: CompiledGlobalAllowlist): SecretFinding[] {
  if (isAllowlistedPath(path, global)) return [];
  const lowered = text.toLowerCase();
  const findings = new Map<string, SecretFinding>();

  for (const rule of rules) {
    if (rule.pathRegex && !re2Matches(rule.pathRegex, path)) continue;
    if (rule.regex === null) {
      // A path-only rule: the file itself is the finding (for example a private key file).
      findings.set(`${rule.id}:1`, { ruleId: rule.id, path, line: 1 });
      continue;
    }
    if (rule.keywords.length > 0 && !rule.keywords.some((keyword) => lowered.includes(keyword))) continue;

    const matcher = rule.regex.matcher(text);
    while (matcher.find()) {
      const start = matcher.start();
      const candidate: Candidate = {
        secret: secretOf(matcher, rule.secretGroup),
        match: matcher.group() ?? '',
        line: lineText(text, start),
        path,
      };
      if (candidate.secret === '') continue;
      if (rule.entropy !== null && shannonEntropy(candidate.secret) < rule.entropy) continue;
      if (rule.allowlists.some((list) => allowed(list, candidate))) continue;
      if (allowed({ ...global, paths: [] }, candidate)) continue;
      const line = lineAt(text, start);
      findings.set(`${rule.id}:${line}`, { ruleId: rule.id, path, line });
    }
  }
  return [...findings.values()].sort((a, b) => a.line - b.line || (a.ruleId < b.ruleId ? -1 : 1));
}
