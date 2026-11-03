import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { disposableEmailsSource, exploreSource, gitleaksSource, hipoSource, linguistSource, stopwordsSource } from '@commitmates/sources';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYNCED_SOURCE_NAMES, attributionSources } from './service';

let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('attribution (§6.11)', () => {
  it('names exactly the sources the app syncs, so each is credited', () => {
    const modules = [linguistSource, exploreSource, gitleaksSource, stopwordsSource, hipoSource, disposableEmailsSource];
    expect([...SYNCED_SOURCE_NAMES].sort()).toEqual(modules.map((source) => source.name).sort());
  });

  it('gives each source its last sync, and none before the first', async () => {
    await database.sql`insert into source_snapshots (source, version, checksum, item_count, skipped_count, fetched_at)
                       values ('hipo', 'abc', 'c', 10, 0, '2026-11-01T08:00:00Z')`;
    const sources = await attributionSources();
    expect(sources.map((source) => source.name)).toEqual([...SYNCED_SOURCE_NAMES]);
    expect(sources.find((source) => source.name === 'hipo')?.syncedAt?.toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(sources.find((source) => source.name === 'linguist')?.syncedAt).toBeNull();
  });
});
