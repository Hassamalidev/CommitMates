import { readFileSync } from 'node:fs';

import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { resetGitHubClientState } from '@commitmates/github';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runSourceSync } from '../runner';

import { loadStopwords, normalizeStopwords, stopwordsSource } from './source';

const dataset = readFileSync(new URL('../__fixtures__/stopwords/stopwords-iso.json', import.meta.url), 'utf8');
const API = 'https://api.github.com';
const server = createMswServer();
let database: TestDatabase;

function serve(body: string) {
  const reset = Math.floor(Date.now() / 1000) + 3600;
  server.use(
    http.get(`${API}/rate_limit`, () => HttpResponse.json({ resources: { core: { limit: 5000, remaining: 4999, reset } } })),
    http.get(`${API}/repos/stopwords-iso/stopwords-iso/contents/stopwords-iso.json`, () =>
      new HttpResponse(body, {
        headers: { 'content-type': 'text/plain', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' },
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
  await database.sql`truncate stopwords, source_snapshots, api_cache, github_budgets`;
});

describe('normalizeStopwords', () => {
  it('cleans and sorts each language and skips codes that are not ISO 639-1', () => {
    const items = normalizeStopwords(JSON.stringify({ en: [' The', 'and', 'the', ''], de: ['und'], 'zh-tw': ['的'] }));
    expect(items).toEqual([
      { language: 'en', words: ['and', 'the'], checksum: expect.stringMatching(/^[0-9a-f]{64}$/) as string },
      { language: 'de', words: ['und'], checksum: expect.any(String) as string },
    ]);
  });

  it('rejects something that is not a stopword dataset', () => {
    expect(() => normalizeStopwords('[]')).toThrow();
    expect(() => normalizeStopwords('{}')).toThrow(/no languages/);
  });
});

describe('stopwordsSource', () => {
  it('syncs every language, skips unchanged ones and serves them by language', async () => {
    serve(dataset);
    expect(await runSourceSync(stopwordsSource)).toMatchObject({ status: 'synced', inserted: 2 });
    expect((await loadStopwords('en')).has('the')).toBe(true);
    expect((await loadStopwords('de')).size).toBeGreaterThan(0);
    // An unknown language falls back to English.
    expect((await loadStopwords('xx')).has('the')).toBe(true);

    resetGitHubClientState();
    await database.sql`delete from api_cache`;
    const changed = JSON.parse(dataset) as Record<string, string[]>;
    changed.de = [...(changed.de ?? []), 'zusätzlich'];
    serve(JSON.stringify(changed));
    expect(await runSourceSync(stopwordsSource)).toMatchObject({ status: 'synced', updated: 1, skipped: 1 });
  });

  it('is empty before the first sync', async () => {
    expect((await loadStopwords('en')).size).toBe(0);
  });
});
