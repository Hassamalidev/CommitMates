import { createHash } from 'node:crypto';

import { schema } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceContext, SourceModule, SyncCounts } from '../contract';

import { normalizeLinguist, type LanguageItem, type LinguistItem, type LinguistRaw, type PatternItem } from './normalize';

const { languages, pathPatterns } = schema;

/** Where Linguist publishes its data (CLAUDE.md §6.3). */
const LINGUIST_REPO = { owner: 'github-linguist', repo: 'linguist' } as const;
const FILES = {
  languages: 'lib/linguist/languages.yml',
  vendor: 'lib/linguist/vendor.yml',
  documentation: 'lib/linguist/documentation.yml',
} as const;
/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';

async function fetchFile(ctx: SourceContext, path: string): Promise<string> {
  return githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now }).get(
    // {+path}: reserved expansion keeps the slashes of a nested path unencoded.
    'GET /repos/{owner}/{repo}/contents/{+path}',
    { ...LINGUIST_REPO, path },
    z.string().min(1),
    { accept: RAW_MEDIA_TYPE, cache: 'reference', what: `${LINGUIST_REPO.owner}/${LINGUIST_REPO.repo}/${path}` },
  );
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

async function syncLanguages(items: LanguageItem[], ctx: SourceContext): Promise<SyncCounts> {
  const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
  const syncedAt = ctx.now();
  const existing = new Map((await ctx.db.select().from(languages)).map((row) => [row.name, row]));
  const added: (typeof languages.$inferInsert)[] = [];

  for (const item of items) {
    const row = existing.get(item.name);
    existing.delete(item.name);
    const values = { color: item.color, extensions: item.extensions, aliases: item.aliases, syncedAt };
    if (!row) {
      added.push({ name: item.name, ...values });
      counts.inserted += 1;
    } else if (row.color !== item.color || !sameList(row.extensions, item.extensions) || !sameList(row.aliases, item.aliases)) {
      await ctx.db.update(languages).set(values).where(eq(languages.name, item.name));
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
  // One statement for all new rows: a first sync inserts several hundred.
  if (added.length > 0) await ctx.db.insert(languages).values(added);
  const removed = [...existing.keys()];
  if (removed.length > 0) {
    await ctx.db.delete(languages).where(inArray(languages.name, removed));
    counts.deleted = removed.length;
  }
  return counts;
}

async function syncPatterns(items: PatternItem[], ctx: SourceContext): Promise<SyncCounts> {
  const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
  const syncedAt = ctx.now();
  const key = (kind: string, pattern: string) => `${kind}\u0000${pattern}`;
  const existing = new Map((await ctx.db.select().from(pathPatterns)).map((row) => [key(row.kind, row.pattern), row]));
  const added: (typeof pathPatterns.$inferInsert)[] = [];

  for (const item of items) {
    const row = existing.get(key(item.patternKind, item.pattern));
    existing.delete(key(item.patternKind, item.pattern));
    if (!row) {
      added.push({ kind: item.patternKind, pattern: item.pattern, compiledOk: item.compiledOk, syncedAt });
      counts.inserted += 1;
    } else if (row.compiledOk !== item.compiledOk) {
      await ctx.db.update(pathPatterns).set({ compiledOk: item.compiledOk, syncedAt }).where(eq(pathPatterns.id, row.id));
      counts.updated += 1;
    } else {
      counts.skipped += 1;
    }
  }
  if (added.length > 0) await ctx.db.insert(pathPatterns).values(added);
  const removed = [...existing.values()].map((row) => row.id);
  if (removed.length > 0) {
    await ctx.db.delete(pathPatterns).where(inArray(pathPatterns.id, removed));
    counts.deleted = removed.length;
  }
  return counts;
}

/** GitHub Linguist: language colors and extensions, vendored and documentation path rules. */
export const linguistSource: SourceModule<LinguistRaw, LinguistItem> = {
  name: 'linguist',

  async fetchRaw(ctx) {
    const raw: LinguistRaw = {
      languages: await fetchFile(ctx, FILES.languages),
      vendor: await fetchFile(ctx, FILES.vendor),
      documentation: await fetchFile(ctx, FILES.documentation),
    };
    const version = createHash('sha256').update(raw.languages).update(raw.vendor).update(raw.documentation).digest('hex');
    return { raw, version };
  },

  normalize: normalizeLinguist,

  countUnusable: (items) => items.filter((item) => item.kind === 'pattern' && !item.compiledOk).length,

  async sync(items, ctx) {
    const languageCounts = await syncLanguages(
      items.filter((item): item is LanguageItem => item.kind === 'language'),
      ctx,
    );
    const patternCounts = await syncPatterns(
      items.filter((item): item is PatternItem => item.kind === 'pattern'),
      ctx,
    );
    return {
      inserted: languageCounts.inserted + patternCounts.inserted,
      updated: languageCounts.updated + patternCounts.updated,
      deleted: languageCounts.deleted + patternCounts.deleted,
      skipped: languageCounts.skipped + patternCounts.skipped,
    };
  },
};
