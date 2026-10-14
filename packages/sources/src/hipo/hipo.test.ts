import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { disposableEmailsSource, normalizeDisposableDomains } from '../disposable-emails/source';
import { runSourceSync } from '../runner';

import { hipoSource, kebab, normalizeUniversities } from './source';

const hipoList = readFileSync(new URL('../__fixtures__/hipo/world_universities_and_domains.json', import.meta.url), 'utf8');
const blocklist = readFileSync(new URL('../__fixtures__/disposable-emails/disposable_email_blocklist.conf', import.meta.url), 'utf8');
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;

function serve(path: string, body: string) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4999, reset } } })),
    http.get(`${API}/repos/${path}`, () =>
      new HttpResponse(body, {
        headers: { 'content-type': 'text/plain', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' },
      }),
    ),
  );
}
const serveHipo = (body: string) => {
  serve('Hipo/university-domains-list/contents/world_universities_and_domains.json', body);
};

/** A fresh fetch: the reference cache would otherwise answer the second sync. */
async function resync(body: string) {
  resetGitHubClientState();
  await database.sql`delete from api_cache`;
  serveHipo(body);
  return runSourceSync(hipoSource);
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
  await database.sql`truncate universities, university_domains, disposable_domains, source_snapshots, api_cache, github_budgets cascade`;
});

describe('normalizeUniversities', () => {
  it('merges repeats, lowercases domains, and skips entries it cannot use', () => {
    const items = normalizeUniversities(hipoList);
    expect(items.map((item) => item.sourceKey)).toEqual([
      'CN:北京大学',
      'DE:ludwig-maximilians-universität münchen',
      'ES:universidad de malaga',
      'ES:universidad de málaga',
      'PK:lahore university of management sciences',
      'US:massachusetts institute of technology',
      'US:shared campus one',
      'US:shared campus two',
    ]);
    const mit = items.find((item) => item.name === 'Massachusetts Institute of Technology');
    expect(mit).toMatchObject({ domains: ['mit.edu', 'sloan.mit.edu'], baseSlug: 'massachusetts-institute-of-technology-us' });
    expect(mit?.webPages).toEqual(['https://mitsloan.mit.edu/', 'https://www.mit.edu/']);
    expect(items.find((item) => item.countryCode === 'PK')).toMatchObject({ domains: ['lums.edu.pk'], stateProvince: 'Punjab' });
  });

  it('builds slugs from the name, or from the first domain when the name has no Latin letters', () => {
    const items = normalizeUniversities(hipoList);
    expect(items.find((item) => item.countryCode === 'DE')?.baseSlug).toBe('ludwig-maximilians-universitat-munchen-de');
    expect(items.find((item) => item.countryCode === 'CN')?.baseSlug).toBe('pku-edu-cn-cn');
    expect(kebab('  École   Polytechnique! ')).toBe('ecole-polytechnique');
  });

  it('rejects something that is not the list', () => {
    expect(() => normalizeUniversities('{}')).toThrow();
    expect(() => normalizeUniversities('[{"name":"x"}]')).toThrow(/no usable entries/);
  });
});

describe('hipoSource', () => {
  it('inserts every university with its domains and unique slugs', async () => {
    serveHipo(hipoList);
    expect(await runSourceSync(hipoSource)).toMatchObject({ status: 'synced', inserted: 8, itemCount: 8 });
    const slugs = await database.sql`select slug from universities where country_code = 'ES' order by slug`;
    // Two names that differ only by an accent: the second takes "-2".
    expect(slugs.map((row) => row.slug)).toEqual(['universidad-de-malaga-es', 'universidad-de-malaga-es-2']);
    const shared = await database.sql`select count(*)::int as count from university_domains where domain = 'shared.example.edu'`;
    expect(shared[0]?.count).toBe(2);
    const [snapshot] = await database.sql`select item_count, last_error from source_snapshots where source = 'hipo'`;
    expect(snapshot).toMatchObject({ item_count: 8, last_error: null });
  });

  it('updates changed rows, deletes dropped ones without members and keeps those with members', async () => {
    serveHipo(hipoList);
    await runSourceSync(hipoSource);
    const [lums] = await database.sql<{ id: string; slug: string }[]>`select id, slug from universities where country_code = 'PK'`;
    await database.sql`update universities set member_count = 3 where country_code = 'CN'`;

    const entries = JSON.parse(hipoList) as Record<string, unknown>[];
    const next = entries
      .filter((entry) => entry.alpha_two_code !== 'CN' && entry.alpha_two_code !== 'DE')
      .map((entry) => (entry.alpha_two_code === 'PK' ? { ...entry, domains: ['lums.edu.pk', 'sse.lums.edu.pk'] } : entry));
    expect(await resync(JSON.stringify(next))).toMatchObject({ status: 'synced', inserted: 0, updated: 2, deleted: 1, skipped: 5 });

    // The changed university keeps its id and slug, so members and links stay valid.
    const [after] = await database.sql<{ id: string; slug: string }[]>`select id, slug from universities where country_code = 'PK'`;
    expect(after).toEqual(lums);
    const domains = await database.sql`select domain from university_domains where university_id = ${lums!.id} order by domain`;
    expect(domains.map((row) => row.domain)).toEqual(['lums.edu.pk', 'sse.lums.edu.pk']);
    // Dropped with members: kept and marked. Dropped without: gone, with its domains.
    expect(await database.sql`select source_missing from universities where country_code = 'CN'`).toEqual([{ source_missing: true }]);
    expect(await database.sql`select 1 from universities where country_code = 'DE'`).toHaveLength(0);
    expect(await database.sql`select 1 from university_domains where domain = 'lmu.de'`).toHaveLength(0);

    // Back in the list: no longer marked.
    expect(await resync(hipoList)).toMatchObject({ inserted: 1, updated: 2 });
    expect(await database.sql`select source_missing from universities where country_code = 'CN'`).toEqual([{ source_missing: false }]);
  });

  it('keeps the last good data when the list cannot be parsed', async () => {
    serveHipo(hipoList);
    await runSourceSync(hipoSource);
    await expect(resync('not json')).rejects.toThrow();
    expect(await database.sql`select 1 from universities`).toHaveLength(8);
    const [snapshot] = await database.sql`select last_error from source_snapshots where source = 'hipo'`;
    expect(snapshot?.last_error).toMatch(/SyntaxError/);
  });
});

describe('disposableEmailsSource', () => {
  it('normalizes the blocklist', () => {
    expect(normalizeDisposableDomains(blocklist)).toEqual(['10minutemail.com', 'guerrillamail.com', 'mailinator.com']);
    expect(() => normalizeDisposableDomains('# only comments\n')).toThrow(/empty/);
  });

  it('adds new domains and removes ones the list dropped', async () => {
    serve('disposable-email-domains/disposable-email-domains/contents/disposable_email_blocklist.conf', blocklist);
    expect(await runSourceSync(disposableEmailsSource)).toMatchObject({ status: 'synced', inserted: 3, deleted: 0 });

    resetGitHubClientState();
    await database.sql`delete from api_cache`;
    serve('disposable-email-domains/disposable-email-domains/contents/disposable_email_blocklist.conf', 'mailinator.com\nyopmail.com\n');
    expect(await runSourceSync(disposableEmailsSource)).toMatchObject({ inserted: 1, deleted: 2, skipped: 1 });
    const rows = await database.sql`select domain from disposable_domains order by domain`;
    expect(rows.map((row) => row.domain)).toEqual(['mailinator.com', 'yopmail.com']);
  });
});
