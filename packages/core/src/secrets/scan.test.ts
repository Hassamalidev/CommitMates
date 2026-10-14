import { readFileSync } from 'node:fs';

import { normalizeGitleaks, type GlobalAllowlistItem, type SecretRuleItem } from '@commitmates/sources';
import { describe, expect, it } from 'vitest';

import { compileGlobalAllowlist, compileRules, isAllowlistedPath, scanFile } from './scan';

const config = readFileSync(new URL('../../../sources/src/__fixtures__/gitleaks/gitleaks.toml', import.meta.url), 'utf8');
const items = normalizeGitleaks(config);
const rules = compileRules(items.filter((item): item is SecretRuleItem => item.kind === 'rule'));
const globalItem = items.find((item): item is GlobalAllowlistItem => item.kind === 'global');
if (!globalItem) throw new Error('fixture has no global allowlist');
const global = compileGlobalAllowlist(globalItem.allowlist);

/*
 * Fake secrets are assembled at runtime so that no secret-shaped string is ever committed:
 * the repository's own secret scanning and GitHub push protection would rightly flag one.
 */
const AWS_KEY = ['AKIA', 'QZ7X', 'WV2T', 'RS5P', 'NM3K'].join('');
const GITHUB_TOKEN = ['ghp', '_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'].join('');
const API_KEY = ['x9Fq2', 'Lr8Zt5', 'Wm1Kc7', 'Vb3Nh6'].join('');
const KEY_BODY = Array.from({ length: 4 }, (_, line) => `MIIEpQ${line}IBAAKCAQEA7x9Fq2Lr8Zt5Wm1Kc7Vb3Nh6Pj4Rs2Tu8Yw0Xz5`).join('\n');
const PRIVATE_KEY = ['-----BEGIN RSA ', 'PRIVATE KEY-----\n', KEY_BODY, '\n-----END RSA ', 'PRIVATE KEY-----'].join('');
const PLANTED = [AWS_KEY, GITHUB_TOKEN, API_KEY, PRIVATE_KEY, KEY_BODY];

const source = [
  "import { client } from './client';",
  '',
  `const awsKey = '${AWS_KEY}';`,
  `const token = "${GITHUB_TOKEN}";`,
  `api_key = "${API_KEY}"`,
  '',
  PRIVATE_KEY,
  'export default client;',
].join('\n');

describe('compileRules', () => {
  it('compiles every usable rule and skips the rest', () => {
    expect(rules.map((rule) => rule.id).sort()).toEqual(['aws-access-token', 'generic-api-key', 'github-pat', 'private-key', 'stripe-access-token']);
    const broken = compileRules([
      { id: 'broken', regex: 'x', keywords: [], entropy: null, secretGroup: 0, pathRegex: null, allowlists: [], compiledOk: false },
      { id: 'empty', regex: null, keywords: [], entropy: null, secretGroup: 0, pathRegex: null, allowlists: [], compiledOk: true },
    ]);
    expect(broken).toEqual([]);
  });
});

describe('scanFile', () => {
  it('finds planted secrets on the right lines', () => {
    const findings = scanFile('src/config.ts', source, rules, global);
    // Like gitleaks, the generic rule also reports the named keys on lines 3 and 4.
    expect(findings).toEqual([
      { ruleId: 'aws-access-token', path: 'src/config.ts', line: 3 },
      { ruleId: 'generic-api-key', path: 'src/config.ts', line: 3 },
      { ruleId: 'generic-api-key', path: 'src/config.ts', line: 4 },
      { ruleId: 'github-pat', path: 'src/config.ts', line: 4 },
      { ruleId: 'generic-api-key', path: 'src/config.ts', line: 5 },
      { ruleId: 'private-key', path: 'src/config.ts', line: 7 },
    ]);
  });

  it('never carries the secret in what it returns', () => {
    const serialized = JSON.stringify(scanFile('src/config.ts', source, rules, global));
    for (const value of PLANTED) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toContain('AKIA');
  });

  it('skips files without any of a rule’s keywords', () => {
    const noKeywords = `const value = '${API_KEY}';`;
    expect(scanFile('src/a.ts', noKeywords, rules, global)).toEqual([]);
  });

  it('skips low-entropy values that look like placeholders', () => {
    expect(scanFile('src/a.ts', 'api_key = "aaaaaaaaaaaaaaaa"', rules, global)).toEqual([]);
    expect(scanFile('src/a.ts', `const awsKey = '${['AKIA', 'AAAAAAAAAAAAAAAA'].join('')}';`, rules, global)).toEqual([]);
  });

  it('honors the rules’ own allowlists', () => {
    // gitleaks allows AWS keys ending in EXAMPLE, the form AWS documentation uses.
    const example = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');
    expect(scanFile('src/a.ts', `const awsKey = '${example}';`, rules, global)).toEqual([]);
  });

  it('skips files on the global path allowlist', () => {
    expect(isAllowlistedPath('package-lock.json', global)).toBe(true);
    expect(isAllowlistedPath('node_modules/x/index.js', global)).toBe(true);
    expect(isAllowlistedPath('src/config.ts', global)).toBe(false);
    expect(scanFile('node_modules/x/index.js', source, rules, global)).toEqual([]);
  });

  it('reports one finding per rule and line', () => {
    const twice = `const a = '${GITHUB_TOKEN}', b = '${GITHUB_TOKEN}';`;
    expect(scanFile('src/a.ts', twice, rules, global)).toEqual([{ ruleId: 'github-pat', path: 'src/a.ts', line: 1 }]);
  });

  it('applies path-only and path-scoped rules', () => {
    const pathRules = compileRules([
      { id: 'key-file', regex: null, keywords: [], entropy: null, secretGroup: 0, pathRegex: '\\.pem$', allowlists: [], compiledOk: true },
      { id: 'env-only', regex: 'SECRET=\\S+', keywords: [], entropy: null, secretGroup: 0, pathRegex: '\\.env$', allowlists: [], compiledOk: true },
    ]);
    expect(scanFile('keys/server.pem', 'anything', pathRules, global)).toEqual([{ ruleId: 'key-file', path: 'keys/server.pem', line: 1 }]);
    expect(scanFile('config/.env', 'A=1\nSECRET=x7', pathRules, global)).toEqual([{ ruleId: 'env-only', path: 'config/.env', line: 2 }]);
    expect(scanFile('src/a.ts', 'SECRET=x7', pathRules, global)).toEqual([]);
  });

  it('uses the configured secret group and AND allowlists', () => {
    const grouped = compileRules([
      {
        id: 'grouped',
        regex: 'pw:(\\w+):(\\w+)',
        keywords: ['pw:'],
        entropy: null,
        secretGroup: 2,
        pathRegex: null,
        allowlists: [{ condition: 'AND', regexTarget: 'secret', regexes: ['^ok'], paths: ['^test/'], stopwords: [] }],
        compiledOk: true,
      },
    ]);
    expect(scanFile('src/a.ts', 'pw:user:okvalue', grouped, global)).toHaveLength(1);
    // Both conditions hold only under test/.
    expect(scanFile('test/a.ts', 'pw:user:okvalue', grouped, global)).toEqual([]);
    expect(scanFile('test/a.ts', 'pw:user:value', grouped, global)).toHaveLength(1);
  });
});
