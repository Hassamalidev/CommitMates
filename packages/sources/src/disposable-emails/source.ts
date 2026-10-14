import { createHash } from 'node:crypto';

import { schema } from '@commitmates/db';
import { SERVER_IDENTITY, githubFor } from '@commitmates/github';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { SourceModule, SyncCounts } from '../contract';

const { disposableDomains } = schema;

/** The disposable-email-domains blocklist (CC0-1.0), chosen in ADR-007. */
const REPO = { owner: 'disposable-email-domains', repo: 'disposable-email-domains' } as const;
const FILE = 'disposable_email_blocklist.conf';
/** Asks the contents API for the file body instead of base64 JSON. */
const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json';
/** Rows per statement, well under Postgres' parameter limit. */
const BATCH = 1000;

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** One domain per line, lowercased and deduplicated; blank lines and `#` comments are skipped. */
export function normalizeDisposableDomains(raw: string): string[] {
  const domains = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const domain = line.trim().toLowerCase().replace(/\.$/, '');
    if (domain === '' || domain.startsWith('#') || !domain.includes('.') || /\s/.test(domain)) continue;
    domains.add(domain);
  }
  if (domains.size === 0) throw new Error('disposable domain list is empty');
  return [...domains].sort();
}

/** Throwaway email domains rejected during university verification (CLAUDE.md §6.5). */
export const disposableEmailsSource: SourceModule<string, string> = {
  name: 'disposable_emails',

  async fetchRaw(ctx) {
    const raw = await githubFor(SERVER_IDENTITY, { db: ctx.db, now: ctx.now }).get(
      'GET /repos/{owner}/{repo}/contents/{+path}',
      { ...REPO, path: FILE },
      z.string().min(1),
      { accept: RAW_MEDIA_TYPE, cache: 'reference', what: `${REPO.owner}/${REPO.repo}/${FILE}` },
    );
    return { raw, version: createHash('sha256').update(raw).digest('hex') };
  },

  normalize: normalizeDisposableDomains,

  async sync(items, ctx) {
    const counts: SyncCounts = { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
    const current = new Set((await ctx.db.select({ domain: disposableDomains.domain }).from(disposableDomains)).map((row) => row.domain));
    const added = items.filter((domain) => !current.has(domain));
    const listed = new Set(items);
    const removed = [...current].filter((domain) => !listed.has(domain));
    const syncedAt = ctx.now();
    for (const batch of chunks(added, BATCH)) {
      await ctx.db.insert(disposableDomains).values(batch.map((domain) => ({ domain, syncedAt }))).onConflictDoNothing();
    }
    for (const batch of chunks(removed, BATCH)) {
      await ctx.db.delete(disposableDomains).where(inArray(disposableDomains.domain, batch));
    }
    counts.inserted = added.length;
    counts.deleted = removed.length;
    counts.skipped = items.length - added.length;
    return counts;
  },
};
