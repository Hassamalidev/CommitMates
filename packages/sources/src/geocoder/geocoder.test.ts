import { createMswServer } from '@commitmates/config/testing/msw';
import { createDb, setLogger, type DbHandle } from '@commitmates/db';
import { useTestDatabase, withSettings, type TestDatabase } from '@commitmates/db/testing';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isNonPlace,
  lookupLocation,
  normalizeLocation,
  queueLocation,
  resolvePendingLocations,
  timezoneAt,
} from './geocoder';

// The response shape of Nominatim's /search?format=jsonv2&addressdetails=1 (recorded 2026-10-14, trimmed).
const LAHORE = [
  {
    place_id: 219712043,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
    lat: '31.5656822',
    lon: '74.3141829',
    category: 'boundary',
    type: 'administrative',
    importance: 0.6817,
    name: 'Lahore',
    display_name: 'Lahore, Lahore District, Punjab, Pakistan',
    address: { city: 'Lahore', county: 'Lahore District', state: 'Punjab', country: 'Pakistan', country_code: 'pk' },
  },
];

const SEARCH = 'https://nominatim.openstreetmap.org/search';
const server = createMswServer();
let database: TestDatabase;
const FAR = () => Date.now() + 60_000;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  await database.sql`truncate geocode_cache`;
  await database.sql`update geocoder_lock set last_call_at = null`;
});

describe('normalizeLocation', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeLocation('  Lahore,   Pakistan ')).toBe('lahore, pakistan');
    expect(normalizeLocation('São Paulo')).toBe('são paulo');
  });

  it('strips emoji and URLs', () => {
    expect(normalizeLocation('🇵🇰 Karachi 🚀')).toBe('karachi');
    expect(normalizeLocation('Berlin https://example.com/me')).toBe('berlin');
    expect(normalizeLocation('www.example.com')).toBe('');
    expect(normalizeLocation('👩‍💻')).toBe('');
  });

  it('handles missing and oversized input', () => {
    expect(normalizeLocation(null)).toBe('');
    expect(normalizeLocation(undefined)).toBe('');
    expect(normalizeLocation('x'.repeat(500))).toHaveLength(120);
  });
});

describe('isNonPlace', () => {
  const terms = ['earth', 'internet', 'remote', 'worldwide', 'localhost', 'home'];

  it('rejects the seed vocabulary, empty strings and strings without letters', () => {
    for (const value of ['', 'remote', 'earth', '127.0.0.1', '???', '42']) expect(isNonPlace(value, terms), value).toBe(true);
  });

  it('accepts real places, including ones that contain a term', () => {
    for (const value of ['lahore', 'remote, oregon', 'new home, nd', '東京']) expect(isNonPlace(value, terms), value).toBe(false);
  });
});

describe('timezoneAt', () => {
  it('maps coordinates to IANA zones offline', () => {
    expect(timezoneAt(31.5656822, 74.3141829)).toBe('Asia/Karachi');
    expect(timezoneAt(52.52, 13.405)).toBe('Europe/Berlin');
    expect(timezoneAt(40.7128, -74.006)).toBe('America/New_York');
  });

  it('returns null for impossible coordinates', () => {
    expect(timezoneAt(999, 999)).toBeNull();
  });
});

describe('queueLocation', () => {
  it('stores a place as pending once and returns its key', async () => {
    expect(await queueLocation('Lahore, Pakistan')).toBe('lahore, pakistan');
    expect(await queueLocation('  LAHORE,  pakistan ')).toBe('lahore, pakistan');
    const rows = await database.sql`select query_norm, status from geocode_cache`;
    expect(rows).toEqual([{ query_norm: 'lahore, pakistan', status: 'pending' }]);
  });

  it('marks non-places unresolvable without queueing them', async () => {
    expect(await queueLocation('Remote')).toBe('remote');
    expect(await queueLocation('🌍')).toBeNull();
    expect(await queueLocation(null)).toBeNull();
    const rows = await database.sql`select query_norm, status from geocode_cache`;
    expect(rows).toEqual([{ query_norm: 'remote', status: 'unresolvable' }]);
  });

  it('reads non-place terms from settings', async () => {
    await withSettings({ 'geocoder.nonPlaceTerms': ['the moon'] }, async () => {
      await queueLocation('The Moon');
      await queueLocation('Remote');
    });
    const rows = await database.sql`select query_norm, status from geocode_cache order by query_norm`;
    expect(rows).toEqual([
      { query_norm: 'remote', status: 'pending' },
      { query_norm: 'the moon', status: 'unresolvable' },
    ]);
  });
});

describe('resolvePendingLocations', () => {
  it('resolves a place with the policy headers and stores coordinates, city, country and timezone', async () => {
    let userAgent: string | null = null;
    let query: URLSearchParams | undefined;
    server.use(
      http.get(SEARCH, ({ request }) => {
        userAgent = request.headers.get('user-agent');
        query = new URL(request.url).searchParams;
        return HttpResponse.json(LAHORE);
      }),
    );
    await queueLocation('Lahore, Pakistan');
    await queueLocation('Remote');

    const report = await resolvePendingLocations({ deadline: FAR() });
    expect(report).toEqual({ resolved: 1, unresolvable: 0, failed: 0 });
    expect(userAgent).toBe('CommitMates/1.0 (+http://127.0.0.1:3100; dev@example.com)');
    expect(Object.fromEntries(query ?? [])).toEqual({ format: 'jsonv2', addressdetails: '1', limit: '1', q: 'lahore, pakistan' });

    expect(await lookupLocation(' Lahore,  PAKISTAN')).toMatchObject({
      status: 'resolved',
      lat: 31.5656822,
      lon: 74.3141829,
      city: 'Lahore',
      countryCode: 'PK',
      timezone: 'Asia/Karachi',
      provider: 'nominatim',
    });
    // The non-place never reached the geocoder.
    expect(await lookupLocation('remote')).toMatchObject({ status: 'unresolvable', provider: null });
    expect(await lookupLocation('somewhere new')).toBeNull();
  });

  it('marks a place with no result unresolvable and never asks again', async () => {
    let calls = 0;
    server.use(
      http.get(SEARCH, () => {
        calls += 1;
        return HttpResponse.json([]);
      }),
    );
    await queueLocation('Qwertyuiop City');
    expect(await resolvePendingLocations({ deadline: FAR() })).toEqual({ resolved: 0, unresolvable: 1, failed: 0 });
    expect(await resolvePendingLocations({ deadline: FAR() })).toEqual({ resolved: 0, unresolvable: 0, failed: 0 });
    expect(calls).toBe(1);
  });

  it('keeps a place pending when the geocoder fails, stops, and still records the call time', async () => {
    let calls = 0;
    server.use(
      http.get(SEARCH, () => {
        calls += 1;
        return HttpResponse.json({ error: 'busy' }, { status: 503 });
      }),
    );
    await queueLocation('Lahore');
    await queueLocation('Karachi');
    const sleep = vi.fn(() => Promise.resolve());
    expect(await resolvePendingLocations({ deadline: FAR(), sleep })).toEqual({ resolved: 0, unresolvable: 0, failed: 1 });
    expect(calls).toBe(1);
    const rows = await database.sql`select status from geocode_cache`;
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
    const [lock] = await database.sql`select last_call_at from geocoder_lock`;
    expect(lock!.last_call_at).toBeInstanceOf(Date);
  });

  it('makes no request when the remaining budget is shorter than the interval', async () => {
    await queueLocation('Lahore');
    const report = await resolvePendingLocations({ deadline: Date.now() + 500 });
    expect(report).toEqual({ resolved: 0, unresolvable: 0, failed: 0 });
  });

  it('never calls faster than geocoder.minIntervalMs, even from concurrent ticks', async () => {
    // One simulated clock shared by both ticks: sleeping advances it, nothing else does.
    let clock = Date.parse('2026-10-14T12:00:00.000Z');
    const callTimes: number[] = [];
    server.use(
      http.get(SEARCH, () => {
        callTimes.push(clock);
        return HttpResponse.json(LAHORE);
      }),
    );
    for (let index = 0; index < 8; index += 1) await queueLocation(`Place number ${index}`);

    const options = {
      deadline: FAR(),
      now: () => new Date(clock),
      sleep: (ms: number) => {
        clock += ms;
        return Promise.resolve();
      },
    };
    // Each tick gets its own connection pool, as two serverless invocations would.
    const pools: DbHandle[] = [createDb(database.url), createDb(database.url)];
    try {
      const reports = await Promise.all(pools.map((pool) => resolvePendingLocations({ ...options, db: pool.db })));
      expect(reports[0]!.resolved + reports[1]!.resolved).toBe(8);
    } finally {
      await Promise.all(pools.map((pool) => pool.close()));
    }

    expect(callTimes).toHaveLength(8);
    const gaps = callTimes.slice(1).map((time, index) => time - callTimes[index]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1100);
    expect(await database.sql`select 1 from geocode_cache where status = 'pending'`).toHaveLength(0);
  });

  it('follows a changed interval', async () => {
    let clock = Date.parse('2026-10-14T12:00:00.000Z');
    const waits: number[] = [];
    server.use(http.get(SEARCH, () => HttpResponse.json(LAHORE)));
    await queueLocation('A place');
    await queueLocation('B place');
    await withSettings({ 'geocoder.minIntervalMs': 3000 }, () =>
      resolvePendingLocations({
        deadline: FAR(),
        now: () => new Date(clock),
        sleep: (ms) => {
          waits.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      }),
    );
    expect(waits).toEqual([3000]);
  });
});
