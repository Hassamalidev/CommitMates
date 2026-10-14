import { getDb, getSetting, schema } from '@commitmates/db';
import { fetchBlobText, fetchTree, githubFor, type TokenIdentity } from '@commitmates/github';
import { createPathMatcher } from '@commitmates/sources';
import { eq } from 'drizzle-orm';

import { compileGlobalAllowlist, compileRules, isAllowlistedPath, scanFile, type SecretFinding } from './scan';

const { languages, pathPatterns, secretGlobalAllowlist, secretRules } = schema;

/** Time kept in hand before the deadline for storing what was found. */
const DEADLINE_MARGIN_MS = 3000;

export type ScanTarget = { owner: string; name: string; defaultBranch: string | null };

export type RepoFinding = SecretFinding & { repo: string };

export type ScanReport = {
  findings: RepoFinding[];
  filesScanned: number;
  /** True when a repository tree was cut short by GitHub, or the file cap or deadline stopped the scan. */
  partial: boolean;
  /** False when no rules have been synced yet; nothing was scanned. */
  rulesAvailable: boolean;
};

/** Lowercased file extensions Linguist knows, with their dot: the files worth reading as text. */
async function textExtensions(): Promise<Set<string>> {
  const rows = await getDb().select({ extensions: languages.extensions }).from(languages);
  return new Set(rows.flatMap((row) => row.extensions.map((extension) => extension.toLowerCase())));
}

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

/**
 * Scans repositories for leaked secrets with gitleaks' rules (CLAUDE.md §8 F3 "Secret scan"):
 * text files by Linguist extension, at most `recruiter.secretScan.maxFileBytes` each and
 * `recruiter.secretScan.maxFiles` in all, never vendored code. Reports where secrets are and
 * never what they are.
 */
export async function scanRepositories(
  identity: TokenIdentity,
  targets: readonly ScanTarget[],
  options: { now?: () => Date; deadline?: number } = {},
): Promise<ScanReport> {
  const db = getDb();
  const [maxFiles, maxFileBytes, ruleRows, globalRows, patterns, extensions] = await Promise.all([
    getSetting('recruiter.secretScan.maxFiles'),
    getSetting('recruiter.secretScan.maxFileBytes'),
    db.select().from(secretRules).where(eq(secretRules.compiledOk, true)),
    db.select().from(secretGlobalAllowlist),
    db.select({ kind: pathPatterns.kind, pattern: pathPatterns.pattern, compiledOk: pathPatterns.compiledOk }).from(pathPatterns),
    textExtensions(),
  ]);
  const rules = compileRules(ruleRows);
  if (rules.length === 0) return { findings: [], filesScanned: 0, partial: false, rulesAvailable: false };
  const global = compileGlobalAllowlist(
    globalRows[0]?.allowlist ?? { condition: 'OR', regexTarget: 'secret', regexes: [], paths: [], stopwords: [] },
  );
  const vendored = createPathMatcher(patterns);
  const client = githubFor(identity, options.now ? { now: options.now } : {});
  const request = options.deadline === undefined ? {} : { deadline: options.deadline };
  const outOfTime = () => options.deadline !== undefined && Date.now() > options.deadline - DEADLINE_MARGIN_MS;

  const findings: RepoFinding[] = [];
  let filesScanned = 0;
  let partial = false;

  for (const target of targets) {
    if (filesScanned >= maxFiles || outOfTime()) {
      partial = true;
      break;
    }
    if (!target.defaultBranch) continue;
    const tree = await fetchTree(client, target.owner, target.name, target.defaultBranch, request);
    if (tree.truncated) partial = true;

    const files = tree.entries.filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.size > 0 &&
        entry.size <= maxFileBytes &&
        extensions.has(extensionOf(entry.path)) &&
        !vendored.isVendored(entry.path) &&
        !isAllowlistedPath(entry.path, global),
    );
    for (const file of files) {
      if (filesScanned >= maxFiles || outOfTime()) {
        partial = true;
        break;
      }
      const text = await fetchBlobText(client, target.owner, target.name, file.sha, request);
      filesScanned += 1;
      if (text === null) continue;
      for (const finding of scanFile(file.path, text, rules, global)) {
        findings.push({ ...finding, repo: `${target.owner}/${target.name}` });
      }
    }
  }
  return { findings, filesScanned, partial, rulesAvailable: true };
}
