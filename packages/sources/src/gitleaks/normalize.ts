import { createHash } from 'node:crypto';

import type { SecretAllowlist } from '@commitmates/db';
import { parse } from 'smol-toml';
import { z } from 'zod';

import { compileRe2 } from '../linguist/regex';

export type SecretRuleItem = {
  kind: 'rule';
  id: string;
  description: string;
  regex: string | null;
  keywords: string[];
  entropy: number | null;
  secretGroup: number;
  pathRegex: string | null;
  allowlists: SecretAllowlist[];
  /** False when RE2 cannot compile one of the rule's own patterns; the scanner skips the rule. */
  compiledOk: boolean;
  checksum: string;
};

export type GlobalAllowlistItem = { kind: 'global'; allowlist: SecretAllowlist };

export type GitleaksItem = SecretRuleItem | GlobalAllowlistItem;

const strings = z.array(z.string()).optional();

const allowlistSchema = z.object({
  condition: z.string().optional(),
  regexTarget: z.string().optional(),
  regexes: strings,
  paths: strings,
  stopwords: strings,
});

const ruleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  regex: z.string().optional(),
  path: z.string().optional(),
  keywords: strings,
  entropy: z.number().optional(),
  secretGroup: z.number().int().nonnegative().optional(),
  allowlists: z.array(allowlistSchema).optional(),
  // Older configs used a single table.
  allowlist: allowlistSchema.optional(),
});

const configSchema = z.object({
  rules: z.array(ruleSchema).default([]),
  allowlist: allowlistSchema.optional(),
  allowlists: z.array(allowlistSchema).optional(),
});

function toAllowlist(raw: z.infer<typeof allowlistSchema>): SecretAllowlist {
  return {
    condition: raw.condition?.toUpperCase() === 'AND' ? 'AND' : 'OR',
    regexTarget: raw.regexTarget === 'match' || raw.regexTarget === 'line' ? raw.regexTarget : 'secret',
    regexes: raw.regexes ?? [],
    paths: raw.paths ?? [],
    stopwords: (raw.stopwords ?? []).map((word) => word.toLowerCase()),
  };
}

/** Patterns that RE2 cannot compile make a rule unusable; allowlist patterns are dropped one by one. */
const compiles = (pattern: string | null) => pattern === null || compileRe2(pattern) !== null;

/**
 * Parses gitleaks' TOML configuration into rules and the global allowlist (CLAUDE.md §6.7).
 * Throws on a document that is not a gitleaks configuration, so the last good rules are kept.
 */
export function normalizeGitleaks(raw: string): GitleaksItem[] {
  const config = configSchema.parse(parse(raw));
  if (config.rules.length === 0) throw new Error('gitleaks configuration has no rules');

  const items: GitleaksItem[] = config.rules.map((rule) => {
    const allowlists = [...(rule.allowlists ?? []), ...(rule.allowlist ? [rule.allowlist] : [])].map(toAllowlist).map((list) => ({
      ...list,
      regexes: list.regexes.filter((pattern) => compiles(pattern)),
      paths: list.paths.filter((pattern) => compiles(pattern)),
    }));
    const item = {
      id: rule.id,
      description: rule.description ?? rule.id,
      regex: rule.regex ?? null,
      keywords: [...new Set((rule.keywords ?? []).map((keyword) => keyword.toLowerCase()))],
      entropy: rule.entropy ?? null,
      secretGroup: rule.secretGroup ?? 0,
      pathRegex: rule.path ?? null,
      allowlists,
    };
    return {
      kind: 'rule' as const,
      ...item,
      compiledOk: (item.regex !== null || item.pathRegex !== null) && compiles(item.regex) && compiles(item.pathRegex),
      checksum: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
    };
  });

  const globals = [...(config.allowlist ? [config.allowlist] : []), ...(config.allowlists ?? [])].map(toAllowlist);
  const global: SecretAllowlist = {
    condition: 'OR',
    regexTarget: 'secret',
    regexes: globals.flatMap((list) => list.regexes).filter((pattern) => compiles(pattern)),
    paths: globals.flatMap((list) => list.paths).filter((pattern) => compiles(pattern)),
    stopwords: globals.flatMap((list) => list.stopwords),
  };
  return [...items, { kind: 'global', allowlist: global }];
}
