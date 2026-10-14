import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { ExternalServiceError, RateLimitError, setLogger } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runSourceSync } from '../runner';

import { normalizeExplore, parseTopicFile } from './normalize';
import { exploreSource } from './source';

const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/explore/${name}`, import.meta.url), 'utf8');

type TreeEntry = { path: string; type: string; sha: string };
const baseTree = JSON.parse(fixture('tree.json')) as { sha: string; truncated: boolean; tree: TreeEntry[] };
const SLUGS = ['computer-vision', 'docker', 'machine-learning', 'react'];
const contentBySlug = Object.fromEntries(SLUGS.map((slug) => [slug, fixture(`${slug}.md`)]));

const API = 'https://api.github.com';
const repoUrl = `${API}/repos/github/explore`;
const rate = () => ({
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4990',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-resource': 'core',
});

const server = createMswServer();
let database: TestDatabase;
let blobRequests: string[] = [];

/** Serves a tree and its blobs. `blobs` maps a blob sha to file content. */
function serve(tree: { sha: string; truncated?: boolean; tree: TreeEntry[] }, blobs: Record<string, string>) {
  server.use(
    http.get(`${API}/rate_limit`, () =>
      HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4990, reset: Math.floor(Date.now() / 1000) + 3600 } } }),
    ),
    http.get(repoUrl, () => HttpResponse.json({ default_branch: 'main', extra: true }, { headers: rate() })),
    http.get(`${repoUrl}/git/trees/main`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('recursive')).toBe('1');
      return HttpResponse.json({ truncated: false, ...tree }, { headers: rate() });
    }),
    http.get(`${repoUrl}/git/blobs/:sha`, ({ params, request }) => {
      const sha = String(params.sha);
      blobRequests.push(sha);
      expect(request.headers.get('accept')).toContain('application/vnd.github.raw');
      const content = blobs[sha];
      return content === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404, headers: rate() })
        : new HttpResponse(content, { headers: { ...rate(), 'content-type': 'text/plain; charset=utf-8' } });
    }),
  );
}

const shaOf = (slug: string) => baseTree.tree.find((entry) => entry.path === `topics/${slug}/index.md`)!.sha;
const baseBlobs = Object.fromEntries(SLUGS.map((slug) => [shaOf(slug), contentBySlug[slug]!]));

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
  blobRequests = [];
  await database.sql`truncate topics, source_snapshots, api_cache, github_budgets`;
});

describe('parseTopicFile', () => {
  it('reads the display name and splits comma-separated aliases and related topics', () => {
    expect(parseTopicFile({ slug: 'react', sha: 's1', content: contentBySlug.react! })).toEqual({
      kind: 'topic',
      slug: 'react',
      displayName: 'React',
      aliases: ['react-js', 'reactjs'],
      related: ['angular', 'nextjs', 'react-native', 'vue'],
      blobSha: 's1',
    });
    expect(parseTopicFile({ slug: 'computer-vision', sha: 's2', content: contentBySlug['computer-vision']! })).toMatchObject({
      displayName: 'Computer vision',
      aliases: ['computervision', 'machine-vision'],
    });
  });

  it('drops entries that are not valid slugs, duplicates and self-references', () => {
    const content = '---\ntopic: rust\ndisplay_name: Rust\naliases: rust-lang, Rust Lang, rust-lang, rust\nrelated: \n---\nbody';
    expect(parseTopicFile({ slug: 'rust', sha: 's', content })).toMatchObject({ aliases: ['rust-lang'], related: [] });
  });

  it('rejects files it cannot trust', () => {
    const bad = [
      'no front matter at all',
      '---\ntopic: other\ndisplay_name: Other\n---\n',
      '---\ntopic: rust\n---\n',
      '---\n: : not yaml : [\n---\n',
    ];
    for (const content of bad) expect(parseTopicFile({ slug: 'rust', sha: 's', content })).toBeNull();
  });
});

describe('normalizeExplore', () => {
  it('returns topics, invalid files and the upstream listing', () => {
    const items = normalizeExplore({
      treeSha: 't',
      files: [
        { slug: 'react', sha: 'a', content: contentBySlug.react! },
        { slug: 'broken', sha: 'b', content: 'nothing here' },
      ],
      presentSlugs: ['react', 'broken', 'docker'],
      remaining: 0,
    });
    expect(items.map((item) => item.kind)).toEqual(['topic', 'invalid', 'presence']);
    expect(items[2]).toEqual({ kind: 'presence', slugs: ['broken', 'docker', 'react'] });
    expect(exploreSource.countUnusable?.(items)).toBe(1);
  });
});

describe('explore sync', () => {
  it('fetches every topic file on the first run and ignores other paths', async () => {
    serve(baseTree, baseBlobs);
    const result = await runSourceSync(exploreSource);
    expect(result).toMatchObject({ status: 'synced', inserted: 4, updated: 0, deleted: 0, more: false, version: baseTree.sha });
    expect(blobRequests).toHaveLength(4);

    const rows = await database.sql`select slug, display_name, aliases, related, blob_sha from topics order by slug`;
    expect(rows.map((row) => row.slug)).toEqual(SLUGS);
    expect(rows.find((row) => row.slug === 'docker')).toMatchObject({ display_name: 'Docker', blob_sha: shaOf('docker') });
    const [snapshot] = await database.sql`select version, item_count, last_error from source_snapshots where source = 'explore'`;
    expect(snapshot).toMatchObject({ version: baseTree.sha, last_error: null });
  });

  it('is found by an alias through the indexed array', async () => {
    serve(baseTree, baseBlobs);
    await runSourceSync(exploreSource);
    const rows = await database.sql`select slug from topics where 'reactjs' = any(aliases)`;
    expect(rows).toEqual([{ slug: 'react' }]);
  });

  it('skips the run entirely when the tree has not changed', async () => {
    serve(baseTree, baseBlobs);
    await runSourceSync(exploreSource);
    blobRequests = [];
    expect(await runSourceSync(exploreSource)).toMatchObject({ status: 'unchanged' });
    expect(blobRequests).toEqual([]);
  });

  it('fetches only changed files, and deletes topics removed upstream', async () => {
    serve(baseTree, baseBlobs);
    await runSourceSync(exploreSource);
    blobRequests = [];
    await database.sql`delete from api_cache`;

    const next = {
      sha: 'tree-v2',
      tree: baseTree.tree
        .filter((entry) => entry.path !== 'topics/docker/index.md')
        .map((entry) => (entry.path === 'topics/react/index.md' ? { ...entry, sha: 'react-v2' } : entry))
        .concat({ path: 'topics/zig/index.md', type: 'blob', sha: 'zig-v1' }),
    };
    serve(next, {
      ...baseBlobs,
      'react-v2': contentBySlug.react!.replace('display_name: React', 'display_name: React.js'),
      'zig-v1': '---\ntopic: zig\ndisplay_name: Zig\naliases: ziglang\n---\nZig.',
    });

    const result = await runSourceSync(exploreSource);
    expect(result).toMatchObject({ status: 'synced', inserted: 1, updated: 1, deleted: 1, version: 'tree-v2' });
    expect(blobRequests.sort()).toEqual(['react-v2', 'zig-v1']);
    const rows = await database.sql`select slug, display_name from topics order by slug`;
    expect(rows).toEqual([
      { slug: 'computer-vision', display_name: 'Computer vision' },
      { slug: 'machine-learning', display_name: 'Machine learning' },
      { slug: 'react', display_name: 'React.js' },
      { slug: 'zig', display_name: 'Zig' },
    ]);
  });

  it('works in batches and reports that more remains', async () => {
    serve(baseTree, baseBlobs);
    await withSettings({ 'sources.explore.batchSize': 3 }, async () => {
      const first = await runSourceSync(exploreSource);
      expect(first).toMatchObject({ status: 'synced', inserted: 3, more: true, version: `${baseTree.sha}:1` });
      await database.sql`delete from api_cache`;
      const second = await runSourceSync(exploreSource);
      expect(second).toMatchObject({ status: 'synced', inserted: 1, more: false, version: baseTree.sha });
    });
    expect(blobRequests).toHaveLength(4);
    expect(await database.sql`select 1 from topics`).toHaveLength(4);
  });

  it('stops fetching when the deadline is near and continues later', async () => {
    serve(baseTree, baseBlobs);
    const result = await runSourceSync(exploreSource, { deadline: Date.now() + 1000 });
    expect(result).toMatchObject({ status: 'synced', inserted: 0, more: true });
    expect(blobRequests).toEqual([]);
  });

  it('counts an unusable file without failing the run', async () => {
    serve(baseTree, { ...baseBlobs, [shaOf('docker')]: 'docker without front matter' });
    const result = await runSourceSync(exploreSource);
    expect(result).toMatchObject({ status: 'synced', inserted: 3, skipped: 1, unusable: 1 });
    expect(await database.sql`select 1 from topics where slug = 'docker'`).toHaveLength(0);
  });

  it('never deletes from a truncated listing and keeps the last good data', async () => {
    serve(baseTree, baseBlobs);
    await runSourceSync(exploreSource);
    await database.sql`delete from api_cache`;
    serve({ sha: 'tree-truncated', truncated: true, tree: baseTree.tree.slice(0, 1) }, baseBlobs);
    await expect(runSourceSync(exploreSource)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(await database.sql`select 1 from topics`).toHaveLength(4);
    const [snapshot] = await database.sql`select last_error from source_snapshots where source = 'explore'`;
    expect(snapshot!.last_error).toContain('truncated');
  });

  it('passes a GitHub rate limit through without marking the source as failed', async () => {
    await database.sql`insert into github_budgets (token_identity, resource, "limit", remaining, reset_at, updated_at)
                       values ('server', 'core', 5000, 10, now() + interval '30 minutes', now())`;
    await expect(runSourceSync(exploreSource)).rejects.toBeInstanceOf(RateLimitError);
    expect(await database.sql`select 1 from source_snapshots where source = 'explore'`).toHaveLength(0);
  });
});
