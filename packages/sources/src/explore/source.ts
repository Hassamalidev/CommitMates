import { getSetting, schema } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceContext, SourceModule, SyncCounts } from '../contract';

import {
  TOPIC_SLUG,
  normalizeExplore,
  type ExploreFile,
  type ExploreItem,
  type ExploreRaw,
  type TopicItem,
} from './normalize';

const { topics } = schema;

/** Where GitHub publishes topic metadata (CLAUDE.md §6.2). */
const EXPLORE_REPO = { owner: 'github', repo: 'explore' } as const;
const TOPIC_FILE = /^topics\/([^/]+)\/index\.md$/;
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';
/** Time kept in hand before the deadline for normalizing and writing what was fetched. */
const DEADLINE_MARGIN_MS = 8000;

const repoSchema = z.object({ default_branch: z.string().min(1) });
const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
});

async function fetchRaw(ctx: SourceContext): Promise<{ raw: ExploreRaw; version: string }> {
  const github = githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now });
  const what = `${EXPLORE_REPO.owner}/${EXPLORE_REPO.repo}`;
  const repo = await github.get('GET /repos/{owner}/{repo}', EXPLORE_REPO, repoSchema, { what });
  const tree = await github.get(
    'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
    { ...EXPLORE_REPO, tree_sha: repo.default_branch, recursive: 1 },
    treeSchema,
    { what },
  );

  const upstream = new Map<string, string>();
  for (const entry of tree.tree) {
    const slug = TOPIC_FILE.exec(entry.path)?.[1];
    if (entry.type === 'blob' && slug !== undefined && TOPIC_SLUG.test(slug)) upstream.set(slug, entry.sha);
  }
  // A truncated listing must never be used to decide what was deleted upstream.
  if (tree.truncated) throw new Error('github/explore tree listing was truncated');

  const known = new Map(
    (await ctx.db.select({ slug: topics.slug, blobSha: topics.blobSha }).from(topics)).map((row) => [row.slug, row.blobSha]),
  );
  const changed = [...upstream].filter(([slug, sha]) => known.get(slug) !== sha).sort(([a], [b]) => a.localeCompare(b));

  const batchSize = await getSetting('sources.explore.batchSize', ctx.db);
  const files: ExploreFile[] = [];
  for (const [slug, sha] of changed.slice(0, batchSize)) {
    if (ctx.deadline !== undefined && Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) break;
    const content = await github.get(
      'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
      { ...EXPLORE_REPO, file_sha: sha },
      z.string(),
      { accept: RAW_MEDIA_TYPE, what: `topic ${slug}` },
    );
    files.push({ slug, sha, content });
  }

  const remaining = changed.length - files.length;
  return {
    raw: { treeSha: tree.sha, files, presentSlugs: [...upstream.keys()], remaining },
    // While files remain the version keeps changing, so the next run is never skipped as unchanged.
    version: remaining === 0 ? tree.sha : `${tree.sha}:${remaining}`,
  };
}

async function sync(items: ExploreItem[], ctx: SourceContext): Promise<SyncCounts> {
  const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
  const syncedAt = ctx.now();
  const topicItems = items.filter((item): item is TopicItem => item.kind === 'topic');

  if (topicItems.length > 0) {
    const rows = await ctx.db
      .insert(topics)
      .values(
        topicItems.map((item) => ({
          slug: item.slug,
          displayName: item.displayName,
          aliases: item.aliases,
          related: item.related,
          blobSha: item.blobSha,
          syncedAt,
        })),
      )
      .onConflictDoUpdate({
        target: topics.slug,
        set: {
          displayName: sql`excluded.display_name`,
          aliases: sql`excluded.aliases`,
          related: sql`excluded.related`,
          blobSha: sql`excluded.blob_sha`,
          syncedAt,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    counts.inserted = rows.filter((row) => row.inserted).length;
    counts.updated = rows.length - counts.inserted;
  }

  const presence = items.find((item) => item.kind === 'presence');
  if (presence && presence.slugs.length > 0) {
    const removed = await ctx.db
      .delete(topics)
      .where(notInArray(topics.slug, presence.slugs))
      .returning({ slug: topics.slug });
    counts.deleted = removed.length;
  }
  counts.skipped = items.filter((item) => item.kind === 'invalid').length;
  return counts;
}

/**
 * github/explore topics. Incremental: one tree listing, then only the topic files whose
 * blob sha changed, in batches of `sources.explore.batchSize` within the job's deadline.
 */
export const exploreSource: SourceModule<ExploreRaw, ExploreItem> = {
  name: 'explore',
  allowEmpty: true,
  fetchRaw,
  normalize: normalizeExplore,
  hasMore: (raw) => raw.remaining > 0,
  countUnusable: (items) => items.filter((item) => item.kind === 'invalid').length,
  sync,
};
