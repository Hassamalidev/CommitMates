import { createHash } from 'node:crypto';

import { getDb, schema, type DbOrTx } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceModule, SyncCounts } from '../contract';

const { stopwords } = schema;

/** Where stopwords-iso publishes its lists (MIT). */
const REPO = { owner: 'stopwords-iso', repo: 'stopwords-iso' } as const;
const FILE = 'stopwords-iso.json';
/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';
/** ISO 639-1 codes: two lowercase letters. */
const LANGUAGE = /^[a-z]{2}$/;

export type StopwordItem = { language: string; words: string[]; checksum: string };

const datasetSchema = z.record(z.string(), z.array(z.string()));

/** One item per language with its words lowercased, trimmed, deduplicated and sorted. */
export function normalizeStopwords(raw: string): StopwordItem[] {
  const dataset = datasetSchema.parse(JSON.parse(raw));
  const items = Object.entries(dataset)
    .filter(([language]) => LANGUAGE.test(language))
    .map(([language, list]) => {
      const words = [...new Set(list.map((word) => word.trim().toLowerCase()).filter((word) => word !== ''))].sort();
      return { language, words, checksum: createHash('sha256').update(words.join('\n')).digest('hex') };
    })
    .filter((item) => item.words.length > 0);
  if (items.length === 0) throw new Error('stopwords dataset has no languages');
  return items;
}

/** stopwords-iso: the stopword lists YAKE and BM25 use (CLAUDE.md §8 F9 step 1). */
export const stopwordsSource: SourceModule<string, StopwordItem> = {
  name: 'stopwords',

  async fetchRaw(ctx) {
    const raw = await githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now }).get(
      'GET /repos/{owner}/{repo}/contents/{+path}',
      { ...REPO, path: FILE },
      z.string().min(1),
      { accept: RAW_MEDIA_TYPE, cache: 'reference', what: `${REPO.owner}/${REPO.repo}/${FILE}` },
    );
    return { raw, version: createHash('sha256').update(raw).digest('hex') };
  },

  normalize: normalizeStopwords,

  async sync(items, ctx) {
    const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
    const syncedAt = ctx.now();
    const existing = new Map((await ctx.db.select({ language: stopwords.language, checksum: stopwords.checksum }).from(stopwords)).map((row) => [row.language, row.checksum]));
    for (const item of items) {
      const checksum = existing.get(item.language);
      existing.delete(item.language);
      if (checksum === undefined) {
        await ctx.db.insert(stopwords).values({ ...item, syncedAt });
        counts.inserted += 1;
      } else if (checksum !== item.checksum) {
        await ctx.db.update(stopwords).set({ words: item.words, checksum: item.checksum, syncedAt }).where(eq(stopwords.language, item.language));
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    }
    const removed = [...existing.keys()];
    if (removed.length > 0) {
      await ctx.db.delete(stopwords).where(inArray(stopwords.language, removed));
      counts.deleted = removed.length;
    }
    return counts;
  },
};

/** The stopwords of a language, falling back to English; empty before the first sync. */
export async function loadStopwords(language: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ language: stopwords.language, words: stopwords.words })
    .from(stopwords)
    .where(inArray(stopwords.language, [...new Set([language, 'en'])]));
  const match = rows.find((row) => row.language === language) ?? rows.find((row) => row.language === 'en');
  return new Set(match?.words ?? []);
}
