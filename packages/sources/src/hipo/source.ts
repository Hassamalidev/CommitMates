import { createHash } from 'node:crypto';

import { schema } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceModule, SyncCounts } from '../contract';

const { universities, universityDomains } = schema;

/** Where the Hipo university-domains-list is published (MIT). */
const REPO = { owner: 'Hipo', repo: 'university-domains-list' } as const;
const FILE = 'world_universities_and_domains.json';
/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';
/** Rows per insert statement; keeps each statement well under Postgres' parameter limit. */
const INSERT_BATCH = 500;

const entrySchema = z.object({
  name: z.string(),
  country: z.string(),
  alpha_two_code: z.string(),
  'state-province': z.string().nullable().optional(),
  domains: z.array(z.string()),
  web_pages: z.array(z.string()),
});

export type UniversityItem = {
  /** Stable identity in the list: country code and lowercased name. */
  sourceKey: string;
  name: string;
  country: string;
  countryCode: string;
  stateProvince: string | null;
  webPages: string[];
  domains: string[];
  /** Slug before collisions are resolved against existing rows. */
  baseSlug: string;
  checksum: string;
};

/** Lowercase ASCII words joined by hyphens; accents are dropped, other scripts removed. */
export function kebab(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const cleanDomain = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, '');
const isDomain = (domain: string) => domain.includes('.') && !/\s/.test(domain);
const unique = (values: readonly string[]) => [...new Set(values)].sort();

/**
 * One item per university (CLAUDE.md §6.4 "Normalize"): domains lowercased and deduplicated,
 * `slug = kebab(name) + "-" + country code`, and a checksum to skip unchanged rows. The list
 * repeats a few universities; repeats are merged. A name with no Latin letters takes its
 * slug from its first domain.
 */
export function normalizeUniversities(raw: string): UniversityItem[] {
  const entries = z.array(z.unknown()).parse(JSON.parse(raw));
  const byKey = new Map<string, Omit<UniversityItem, 'checksum' | 'baseSlug'>>();
  for (const value of entries) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const name = entry.name.trim().replace(/\s+/g, ' ');
    const countryCode = entry.alpha_two_code.trim().toUpperCase();
    const domains = entry.domains.map(cleanDomain).filter(isDomain);
    if (name === '' || !/^[A-Z]{2}$/.test(countryCode) || domains.length === 0) continue;
    const sourceKey = `${countryCode}:${name.toLowerCase()}`;
    const existing = byKey.get(sourceKey);
    const webPages = entry.web_pages.map((page) => page.trim()).filter((page) => page !== '');
    if (existing) {
      existing.domains = unique([...existing.domains, ...domains]);
      existing.webPages = unique([...existing.webPages, ...webPages]);
      continue;
    }
    byKey.set(sourceKey, {
      sourceKey,
      name,
      country: entry.country.trim(),
      countryCode,
      // An empty province is as good as none.
      stateProvince: entry['state-province']?.trim() ? entry['state-province'].trim() : null,
      webPages: unique(webPages),
      domains: unique(domains),
    });
  }
  const items = [...byKey.values()].map((item) => {
    const nameSlug = kebab(item.name) || kebab(item.domains[0] ?? '');
    return {
      ...item,
      baseSlug: `${nameSlug}-${item.countryCode.toLowerCase()}`,
      checksum: createHash('sha256')
        .update(JSON.stringify([item.name, item.country, item.countryCode, item.stateProvince, item.webPages, item.domains]))
        .digest('hex'),
    };
  });
  if (items.length === 0) throw new Error('university list has no usable entries');
  return items.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

/** The first of `base`, `base-2`, `base-3`… not yet taken; records the choice. */
function claimSlug(base: string, taken: Set<string>): string {
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
  taken.add(slug);
  return slug;
}

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * Hipo university-domains-list: universities and their root email domains (CLAUDE.md §6.4).
 * Diff upsert by checksum. A university the list drops is deleted only when it has no
 * members; otherwise it is kept and marked `source_missing`.
 */
export const hipoSource: SourceModule<string, UniversityItem> = {
  name: 'hipo',

  async fetchRaw(ctx) {
    const raw = await githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now }).get(
      'GET /repos/{owner}/{repo}/contents/{+path}',
      { ...REPO, path: FILE },
      z.string().min(1),
      { accept: RAW_MEDIA_TYPE, cache: 'reference', what: `${REPO.owner}/${REPO.repo}/${FILE}` },
    );
    return { raw, version: createHash('sha256').update(raw).digest('hex') };
  },

  normalize: normalizeUniversities,

  async sync(items, ctx) {
    const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
    const { db } = ctx;
    const existing = await db
      .select({
        id: universities.id,
        sourceKey: universities.sourceKey,
        checksum: universities.checksum,
        sourceMissing: universities.sourceMissing,
        memberCount: universities.memberCount,
      })
      .from(universities)
      .where(eq(universities.source, 'hipo'));
    const byKey = new Map(existing.flatMap((row) => (row.sourceKey === null ? [] : [[row.sourceKey, row] as const])));
    const taken = new Set((await db.select({ slug: universities.slug }).from(universities)).map((row) => row.slug));

    const fresh: UniversityItem[] = [];
    for (const item of items) {
      const row = byKey.get(item.sourceKey);
      byKey.delete(item.sourceKey);
      if (!row) {
        fresh.push(item);
      } else if (row.checksum !== item.checksum || row.sourceMissing) {
        await db
          .update(universities)
          .set({
            name: item.name,
            country: item.country,
            countryCode: item.countryCode,
            stateProvince: item.stateProvince,
            webPages: item.webPages,
            checksum: item.checksum,
            sourceMissing: false,
          })
          .where(eq(universities.id, row.id));
        await db.delete(universityDomains).where(eq(universityDomains.universityId, row.id));
        await db.insert(universityDomains).values(item.domains.map((domain) => ({ domain, universityId: row.id })));
        counts.updated += 1;
      } else {
        counts.skipped += 1;
      }
    }

    for (const batch of chunks(fresh, INSERT_BATCH)) {
      const inserted = await db
        .insert(universities)
        .values(
          batch.map((item) => ({
            name: item.name,
            slug: claimSlug(item.baseSlug, taken),
            country: item.country,
            countryCode: item.countryCode,
            stateProvince: item.stateProvince,
            webPages: item.webPages,
            source: 'hipo' as const,
            sourceKey: item.sourceKey,
            checksum: item.checksum,
          })),
        )
        .returning({ id: universities.id, sourceKey: universities.sourceKey });
      const idByKey = new Map(inserted.map((row) => [row.sourceKey, row.id]));
      const domains = batch.flatMap((item) => {
        const universityId = idByKey.get(item.sourceKey);
        return universityId === undefined ? [] : item.domains.map((domain) => ({ domain, universityId }));
      });
      for (const domainBatch of chunks(domains, INSERT_BATCH)) await db.insert(universityDomains).values(domainBatch);
      counts.inserted += inserted.length;
    }

    // What the list no longer has: kept (and marked) while members belong to it.
    const gone = [...byKey.values()];
    const keep = gone.filter((row) => row.memberCount > 0 && !row.sourceMissing).map((row) => row.id);
    const remove = gone.filter((row) => row.memberCount === 0).map((row) => row.id);
    for (const ids of chunks(keep, INSERT_BATCH)) {
      await db.update(universities).set({ sourceMissing: true }).where(inArray(universities.id, ids));
      counts.updated += ids.length;
    }
    for (const ids of chunks(remove, INSERT_BATCH)) {
      // Re-checked in SQL: a member may have joined since the read above.
      const deleted = await db
        .delete(universities)
        .where(and(inArray(universities.id, ids), eq(universities.memberCount, 0)))
        .returning({ id: universities.id });
      counts.deleted += deleted.length;
    }
    return counts;
  },
};
