import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runSourceSync } from '../runner';

import { normalizeGitleaks, type SecretRuleItem } from './normalize';
import { gitleaksSource } from './source';

const config = readFileSync(new URL('../__fixtures__/gitleaks/gitleaks.toml', import.meta.url), 'utf8');

const API = 'https://api.github.com';
const CONFIG_URL = `${API}/repos/gitleaks/gitleaks/contents/config/gitleaks.toml`;
const server = createMswServer();
let database: TestDatabase;

function serve(body: string) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4999, reset } } })),
    http.get(CONFIG_URL, ({ request }) => {
      expect(request.headers.get('accept')).toContain('application/vnd.github.raw');
      return new HttpResponse(body, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4998',
          'x-ratelimit-reset': String(reset),
          'x-ratelimit-resource': 'core',
        },
      });
    }),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  await database.sql`truncate secret_rules, secret_global_allowlist, source_snapshots, api_cache, github_budgets`;
});

describe('normalizeGitleaks', () => {
  const items = normalizeGitleaks(config);
  const rules = items.filter((item): item is SecretRuleItem => item.kind === 'rule');
  const rule = (id: string) => rules.find((item) => item.id === id);

  it('reads every rule with its keywords, entropy and allowlists', () => {
    expect(rules.map((item) => item.id).sort()).toEqual([
      'aws-access-token',
      'generic-api-key',
      'github-pat',
      'private-key',
      'stripe-access-token',
    ]);
    expect(rule('github-pat')).toMatchObject({ keywords: ['ghp_'], entropy: 3, compiledOk: true });
    expect(rule('aws-access-token')?.keywords).toContain('akia');
    const generic = rule('generic-api-key');
    expect(generic?.entropy).toBe(3.5);
    expect(generic?.allowlists.length).toBeGreaterThan(1);
    expect(generic?.allowlists.some((list) => list.regexTarget === 'line')).toBe(true);
    expect(generic?.allowlists.some((list) => list.stopwords.length > 100)).toBe(true);
  });

  it('compiles every pattern of the default rules with RE2', () => {
    expect(rules.every((item) => item.compiledOk)).toBe(true);
  });

  it('collects the global allowlist', () => {
    const global = items.find((item) => item.kind === 'global');
    expect(global?.kind === 'global' && global.allowlist.paths.length).toBeGreaterThan(10);
    expect(global?.kind === 'global' && global.allowlist.regexes.length).toBeGreaterThan(0);
  });

  it('gives each rule a stable checksum that changes with its content', () => {
    const again = normalizeGitleaks(config).filter((item): item is SecretRuleItem => item.kind === 'rule');
    expect(again.map((item) => item.checksum)).toEqual(rules.map((item) => item.checksum));
    const changed = normalizeGitleaks(config.replace("keywords = [\"ghp_\"]", "keywords = [\"ghp_\", \"github\"]"));
    const pat = changed.find((item): item is SecretRuleItem => item.kind === 'rule' && item.id === 'github-pat');
    expect(pat?.checksum).not.toBe(rule('github-pat')?.checksum);
  });

  it('marks a rule RE2 cannot express and drops allowlist patterns it cannot express', () => {
    const items = normalizeGitleaks(`
[[rules]]
id = "lookahead"
regex = '''secret(?=x)'''

[[rules]]
id = "fine"
regex = '''token_[a-z]{8}'''
[[rules.allowlists]]
regexes = ['''(?<=no)lookbehind''', '''^token_test''']
`);
    const lookahead = items.find((item): item is SecretRuleItem => item.kind === 'rule' && item.id === 'lookahead');
    const fine = items.find((item): item is SecretRuleItem => item.kind === 'rule' && item.id === 'fine');
    expect(lookahead?.compiledOk).toBe(false);
    expect(fine?.compiledOk).toBe(true);
    expect(fine?.allowlists[0]?.regexes).toEqual(['^token_test']);
  });

  it('rejects documents that are not a gitleaks configuration', () => {
    expect(() => normalizeGitleaks('not = [toml')).toThrow();
    expect(() => normalizeGitleaks('title = "empty"')).toThrow(/no rules/);
    expect(() => normalizeGitleaks('[[rules]]\ndescription = "missing id"')).toThrow();
  });
});

describe('gitleaksSource', () => {
  it('syncs rules and the global allowlist, then skips unchanged and removes withdrawn rules', async () => {
    serve(config);
    const first = await runSourceSync(gitleaksSource);
    expect(first).toMatchObject({ status: 'synced', inserted: 5, updated: 0, deleted: 0, unusable: 0 });
    const rows = await database.sql`select id, keywords, compiled_ok, allowlists from secret_rules order by id`;
    expect(rows.map((row) => row.id)).toHaveLength(5);
    const [global] = await database.sql`select allowlist from secret_global_allowlist where id = 'global'`;
    expect((global!.allowlist as { paths: string[] }).paths.length).toBeGreaterThan(10);

    resetGitHubClientState();
    await database.sql`delete from api_cache`;
    const withoutStripe = config.slice(0, config.indexOf('[[rules]]\nid = "stripe-access-token"'));
    serve(withoutStripe.replace('keywords = ["ghp_"]', 'keywords = ["ghp_", "github"]'));
    const second = await runSourceSync(gitleaksSource);
    expect(second).toMatchObject({ status: 'synced', inserted: 0, updated: 1, deleted: 1, skipped: 3 });
    expect((await database.sql`select id from secret_rules order by id`).map((row) => row.id)).not.toContain('stripe-access-token');
  });

  it('keeps the last good rules when the upstream file is broken', async () => {
    serve(config);
    await runSourceSync(gitleaksSource);
    resetGitHubClientState();
    await database.sql`delete from api_cache`;
    serve('this is not toml [');
    await expect(runSourceSync(gitleaksSource)).rejects.toThrow();
    expect(await database.sql`select 1 from secret_rules`).toHaveLength(5);
    const [snapshot] = await database.sql`select last_error from source_snapshots where source = 'gitleaks'`;
    expect(snapshot!.last_error).toBeTruthy();
  });
});
