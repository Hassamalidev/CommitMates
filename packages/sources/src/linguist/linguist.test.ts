import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { ExternalServiceError, setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SourceModule } from '../contract';
import { runSourceSync } from '../runner';

import { createPathMatcher } from './match';
import { normalizeLinguist, type LinguistItem, type LinguistRaw } from './normalize';
import { compileRe2 } from './regex';
import { linguistSource } from './source';

const fixture = (name: string) =>
  readFileSync(new URL(`../__fixtures__/linguist/${name}.yml`, import.meta.url), 'utf8');

const raw: LinguistRaw = {
  languages: fixture('languages'),
  vendor: fixture('vendor'),
  documentation: fixture('documentation'),
};

const API = 'https://api.github.com';
const contents = `${API}/repos/github-linguist/linguist/contents/lib/linguist`;
const rate = {
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-resource': 'core',
};
const server = createMswServer();
let database: TestDatabase;

function serve(files: Record<'languages' | 'vendor' | 'documentation', string>) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } }),
    ),
    ...(['languages', 'vendor', 'documentation'] as const).map((name) =>
      http.get(`${contents}/${name}.yml`, ({ request }) => {
        expect(request.headers.get('accept')).toContain('application/vnd.github.raw');
        return new HttpResponse(files[name], { headers: { ...rate, 'content-type': 'text/plain; charset=utf-8' } });
      }),
    ),
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
  await database.sql`truncate languages, path_patterns, source_snapshots, api_cache, github_budgets`;
});

describe('normalizeLinguist', () => {
  const items = normalizeLinguist(raw);
  const language = (name: string) => items.find((item) => item.kind === 'language' && item.name === name);

  it('reads colors, extensions and aliases', () => {
    expect(language('TypeScript')).toMatchObject({ color: '#3178c6', aliases: ['ts'] });
    expect(language('TypeScript')).toMatchObject({ extensions: expect.arrayContaining(['.ts', '.mts']) });
    expect(language('Python')).toMatchObject({ extensions: expect.arrayContaining(['.py']) });
    expect(items.filter((item) => item.kind === 'language')).toHaveLength(8);
  });

  it('sorts and lowercases lists so diffs are stable', () => {
    const typescript = language('TypeScript');
    expect(typescript?.kind === 'language' && typescript.extensions).toEqual(
      typescript?.kind === 'language' ? [...typescript.extensions].sort() : [],
    );
    expect(normalizeLinguist(raw)).toEqual(items);
  });

  it('keeps every path rule and marks the ones RE2 cannot compile', () => {
    const patterns = items.filter((item) => item.kind === 'pattern');
    expect(patterns.some((item) => item.patternKind === 'vendored' && item.pattern === '(^|/)node_modules/')).toBe(true);
    expect(patterns.some((item) => item.patternKind === 'documentation' && item.pattern === '^[Dd]ocs?/')).toBe(true);
    const unusable = linguistSource.countUnusable?.(items) ?? 0;
    expect(unusable).toBe(patterns.filter((item) => !item.compiledOk).length);
    expect(unusable).toBeLessThan(patterns.length / 10);
  });

  it('ignores malformed language entries and invalid colors', () => {
    const odd = normalizeLinguist({
      languages: 'Good:\n  color: "#ABCDEF"\nBadColor:\n  color: red\nBroken: 42\n',
      vendor: '- (^|/)dist/\n',
      documentation: '- ^docs/\n',
    });
    expect(odd.filter((item) => item.kind === 'language')).toEqual([
      { kind: 'language', name: 'BadColor', color: null, extensions: [], aliases: [] },
      { kind: 'language', name: 'Good', color: '#abcdef', extensions: [], aliases: [] },
    ]);
  });

  it('rejects files with the wrong shape', () => {
    expect(() => normalizeLinguist({ ...raw, vendor: 'not: a list' })).toThrow();
  });
});

describe('RE2 compilation', () => {
  it('compiles ordinary patterns and refuses look-arounds', () => {
    expect(compileRe2('(^|/)vendor/')).not.toBeNull();
    expect(compileRe2('(?<!foo)bar')).toBeNull();
    expect(compileRe2('(a)\\1')).toBeNull();
  });
});

describe('createPathMatcher', () => {
  const matcher = createPathMatcher(
    normalizeLinguist(raw)
      .filter((item) => item.kind === 'pattern')
      .map((item) => ({ kind: item.patternKind, pattern: item.pattern, compiledOk: item.compiledOk })),
  );

  it('recognizes vendored and documentation paths', () => {
    expect(matcher.isVendored('node_modules/react/index.js')).toBe(true);
    expect(matcher.isVendored('web/vendor/jquery.min.js')).toBe(true);
    expect(matcher.isVendored('/dist/bundle.js')).toBe(true);
    expect(matcher.isVendored('src/app/page.tsx')).toBe(false);
    expect(matcher.isDocumentation('docs/guide.md')).toBe(true);
    expect(matcher.isDocumentation('README.md')).toBe(true);
    expect(matcher.isDocumentation('src/index.ts')).toBe(false);
  });

  it('ignores patterns marked as not compilable', () => {
    const none = createPathMatcher([{ kind: 'vendored', pattern: '(^|/)dist/', compiledOk: false }]);
    expect(none.isVendored('dist/x.js')).toBe(false);
  });
});

describe('linguist sync', () => {
  it('fetches the three files through the GitHub client and inserts everything', async () => {
    serve(raw);
    const result = await runSourceSync(linguistSource);
    expect(result).toMatchObject({ status: 'synced', updated: 0, deleted: 0, skipped: 0 });

    const [typescript] = await database.sql`select color, extensions, aliases from languages where name = 'TypeScript'`;
    expect(typescript).toMatchObject({ color: '#3178c6', aliases: ['ts'] });
    const [counts] = await database.sql`
      select (select count(*)::int from languages) as languages, (select count(*)::int from path_patterns) as patterns`;
    expect(counts!.languages).toBe(8);
    expect(result.status === 'synced' && result.inserted).toBe(counts!.languages + counts!.patterns);

    const [snapshot] = await database.sql`select * from source_snapshots where source = 'linguist'`;
    expect(snapshot).toMatchObject({ item_count: counts!.languages + counts!.patterns, last_error: null });
    expect(snapshot!.version).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot!.skipped_count).toBe(result.status === 'synced' ? result.unusable : -1);
  });

  it('does nothing when the upstream content is unchanged', async () => {
    serve(raw);
    await runSourceSync(linguistSource);
    const before = await database.sql`select name, synced_at from languages order by name`;
    expect(await runSourceSync(linguistSource)).toMatchObject({ status: 'unchanged' });
    expect(await database.sql`select name, synced_at from languages order by name`).toEqual(before);
  });

  it('applies a diff: updates changed rows, inserts new ones, deletes removed ones, skips the rest', async () => {
    serve(raw);
    await runSourceSync(linguistSource);

    const changed = raw.languages
      .replace('color: "#3178c6"', 'color: "#000001"')
      .replace(/^Rust:[\s\S]*?(?=^\S)/m, '')
      .concat('\nZig:\n  type: programming\n  color: "#ec915c"\n  extensions:\n  - ".zig"\n');
    await database.sql`delete from api_cache`;
    serve({ ...raw, languages: changed, vendor: raw.vendor.replace('- (^|/)cache/\n', '') });

    const result = await runSourceSync(linguistSource);
    expect(result).toMatchObject({ status: 'synced', inserted: 1, updated: 1, deleted: 2 });
    const names = (await database.sql`select name from languages order by name`).map((row) => row.name);
    expect(names).toContain('Zig');
    expect(names).not.toContain('Rust');
    const [typescript] = await database.sql`select color from languages where name = 'TypeScript'`;
    expect(typescript!.color).toBe('#000001');
    expect(await database.sql`select 1 from path_patterns where pattern = '(^|/)cache/'`).toHaveLength(0);
  });

  it('keeps the last good data and records the error when the source fails', async () => {
    serve(raw);
    await runSourceSync(linguistSource);
    const before = await database.sql`select count(*)::int as count from languages`;

    await database.sql`delete from api_cache`;
    server.use(http.get(`${contents}/languages.yml`, () => HttpResponse.json({ message: 'boom' }, { status: 503 })));
    await expect(runSourceSync(linguistSource)).rejects.toBeInstanceOf(ExternalServiceError);

    expect(await database.sql`select count(*)::int as count from languages`).toEqual(before);
    const [snapshot] = await database.sql`select last_error, item_count from source_snapshots where source = 'linguist'`;
    expect(snapshot!.last_error).toContain('github.server');
    expect(snapshot!.item_count).toBeGreaterThan(0);

    // The next good run clears the error even though the content did not change.
    serve(raw);
    expect(await runSourceSync(linguistSource)).toMatchObject({ status: 'synced' });
    const [healed] = await database.sql`select last_error from source_snapshots where source = 'linguist'`;
    expect(healed!.last_error).toBeNull();
  });

  it('keeps data when the upstream file is unparseable', async () => {
    serve(raw);
    await runSourceSync(linguistSource);
    await database.sql`delete from api_cache`;
    serve({ ...raw, vendor: 'this: is not a list' });
    await expect(runSourceSync(linguistSource)).rejects.toBeInstanceOf(ExternalServiceError);
    const [row] = await database.sql`select count(*)::int as count from path_patterns`;
    expect(row!.count).toBeGreaterThan(50);
  });
});

describe('runSourceSync', () => {
  it('refuses an empty result instead of wiping the table', async () => {
    const empty: SourceModule<string, LinguistItem> = {
      name: 'empty-source',
      fetchRaw: () => Promise.resolve({ raw: '', version: 'v1' }),
      normalize: () => [],
      sync: () => Promise.reject(new Error('must not be called')),
    };
    await expect(runSourceSync(empty)).rejects.toBeInstanceOf(ExternalServiceError);
    const [snapshot] = await database.sql`select last_error from source_snapshots where source = 'empty-source'`;
    expect(snapshot!.last_error).toContain('no usable items');
  });
});
