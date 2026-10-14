import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { getDb, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { SERVER_IDENTITY, resetGitHubClientState } from '@commitmates/github';
import { gitleaksSource, normalizeGitleaks } from '@commitmates/sources';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { scanRepositories } from './scanner';

const config = readFileSync(new URL('../../../sources/src/__fixtures__/gitleaks/gitleaks.toml', import.meta.url), 'utf8');
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;

// Assembled at runtime: no secret-shaped string is committed (see scan.test.ts).
const TOKEN = ['ghp', '_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'].join('');

type File = { path: string; content: string; size?: number };

const blobSha = (repo: string, path: string) => Buffer.from(`${repo}:${path}`).toString('hex').slice(0, 40);

function serveRepo(repo: string, files: File[], options: { truncated?: boolean; requested?: string[] } = {}) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const headers = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' };
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4900, reset } } })),
    http.get(`${API}/repos/someone/${repo}/git/trees/main`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('recursive')).toBe('1');
      return HttpResponse.json(
        {
          sha: 'root',
          truncated: options.truncated ?? false,
          tree: [
            { path: 'src', type: 'tree', sha: 'dir' },
            ...files.map((file) => ({ path: file.path, type: 'blob', sha: blobSha(repo, file.path), size: file.size ?? file.content.length })),
          ],
        },
        { headers },
      );
    }),
    ...files.map((file) =>
      http.get(`${API}/repos/someone/${repo}/git/blobs/${blobSha(repo, file.path)}`, () => {
        options.requested?.push(file.path);
        return new HttpResponse(file.content, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
      }),
    ),
  );
}

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  await gitleaksSource.sync(normalizeGitleaks(config), syncContext());
  await database.sql`
    insert into languages (name, color, extensions, aliases, synced_at) values
      ('TypeScript', '#3178c6', '{.ts,.tsx}', '{}', now()),
      ('JSON', null, '{.json}', '{}', now())`;
  await database.sql`insert into path_patterns (kind, pattern, compiled_ok, synced_at) values ('vendored', '(^|/)vendor/', true, now())`;
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  resetGitHubClientState();
  await database.sql`delete from api_cache`;
  await database.sql`delete from github_budgets`;
});

const syncContext = () => ({ db: getDb(), now: () => new Date(), log: pino({ level: 'silent' }) });

const target = (name: string) => ({ owner: 'someone', name, defaultBranch: 'main' });

describe('scanRepositories', () => {
  it('scans text files of each repository and reports where secrets are, never what they are', async () => {
    const requested: string[] = [];
    serveRepo(
      'app',
      [
        { path: 'src/client.ts', content: `const token = "${TOKEN}";\nexport {};\n` },
        { path: 'src/clean.ts', content: 'export const answer = 42;\n' },
        // Not text by Linguist extension, vendored, too large, or globally allowlisted: never fetched.
        { path: 'logo.png', content: TOKEN },
        { path: 'vendor/lib.ts', content: TOKEN },
        { path: 'src/huge.ts', content: TOKEN, size: 999_999 },
        { path: 'package-lock.json', content: TOKEN },
      ],
      { requested },
    );
    const report = await scanRepositories(SERVER_IDENTITY, [target('app')]);
    expect(report.rulesAvailable).toBe(true);
    expect(report.partial).toBe(false);
    expect(report.filesScanned).toBe(2);
    expect(requested.sort()).toEqual(['src/clean.ts', 'src/client.ts']);
    expect(report.findings).toEqual([
      { ruleId: 'generic-api-key', path: 'src/client.ts', line: 1, repo: 'someone/app' },
      { ruleId: 'github-pat', path: 'src/client.ts', line: 1, repo: 'someone/app' },
    ]);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it('stops at the file cap across repositories and says the scan was partial', async () => {
    serveRepo('one', [
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
    ]);
    serveRepo('two', [{ path: 'src/c.ts', content: `const token = "${TOKEN}";` }]);
    const report = await withSettings({ 'recruiter.secretScan.maxFiles': 2 }, () =>
      scanRepositories(SERVER_IDENTITY, [target('one'), target('two')]),
    );
    expect(report).toMatchObject({ filesScanned: 2, partial: true, findings: [] });
  });

  it('marks a truncated tree as a partial scan and skips repositories without a branch', async () => {
    serveRepo('big', [{ path: 'src/a.ts', content: 'a' }], { truncated: true });
    const report = await scanRepositories(SERVER_IDENTITY, [{ owner: 'someone', name: 'empty', defaultBranch: null }, target('big')]);
    expect(report).toMatchObject({ filesScanned: 1, partial: true });
  });

  it('scans nothing before any rules have been synced', async () => {
    await database.sql`truncate secret_rules`;
    try {
      expect(await scanRepositories(SERVER_IDENTITY, [target('app')])).toEqual({
        findings: [],
        filesScanned: 0,
        partial: false,
        rulesAvailable: false,
      });
    } finally {
      await gitleaksSource.sync(normalizeGitleaks(config), syncContext());
    }
  });
});
