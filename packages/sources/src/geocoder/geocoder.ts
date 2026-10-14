import { ExternalServiceError, getDb, getLogger, getSetting, schema, type Db } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import tzLookup from '@photostructure/tz-lookup';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

const { geocodeCache, geocoderLock } = schema;

/** Longest location text sent to the geocoder; real place names are far shorter. */
const MAX_QUERY_CHARS = 120;
const PROVIDER = 'nominatim';

/**
 * Normalization before lookup (CLAUDE.md §6.8): strip URLs and emoji, collapse
 * whitespace, lowercase. The result is the cache key.
 */
export function normalizeLocation(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u200d|\ufe0f/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_CHARS);
}

/** Strings that are never sent to the geocoder: empty, no letters, or one of `geocoder.nonPlaceTerms`. */
export function isNonPlace(normalized: string, nonPlaceTerms: readonly string[]): boolean {
  if (normalized === '' || !/\p{L}/u.test(normalized)) return true;
  return nonPlaceTerms.some((term) => term.trim().toLowerCase() === normalized);
}

/** The IANA timezone at a coordinate, from an offline table. `null` for coordinates off the map. */
export function timezoneAt(lat: number, lon: number): string | null {
  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
}

export type GeocodeRow = typeof geocodeCache.$inferSelect;

/**
 * Registers a location for geocoding and returns its cache key, or `null` when there is
 * nothing to look up. A new place is stored as `pending` for the paced queue; a non-place
 * is stored as `unresolvable` without ever calling the geocoder.
 */
export async function queueLocation(raw: string | null | undefined, db: Db = getDb()): Promise<string | null> {
  const key = normalizeLocation(raw);
  if (key === '') return null;
  const nonPlace = isNonPlace(key, await getSetting('geocoder.nonPlaceTerms', db));
  await db
    .insert(geocodeCache)
    .values({ queryNorm: key, status: nonPlace ? 'unresolvable' : 'pending' })
    .onConflictDoNothing();
  return key;
}

/** The cached result for a location, if it has been registered. Results are kept forever. */
export async function lookupLocation(raw: string | null | undefined, db: Db = getDb()): Promise<GeocodeRow | null> {
  const key = normalizeLocation(raw);
  if (key === '') return null;
  const [row] = await db.select().from(geocodeCache).where(eq(geocodeCache.queryNorm, key));
  return row ?? null;
}

const resultSchema = z.array(
  z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    importance: z.number().nullish(),
    address: z
      .object({
        city: z.string().nullish(),
        town: z.string().nullish(),
        village: z.string().nullish(),
        municipality: z.string().nullish(),
        county: z.string().nullish(),
        state: z.string().nullish(),
        country_code: z.string().nullish(),
      })
      .nullish(),
  }),
);

type Resolved = { lat: number; lon: number; city: string | null; countryCode: string | null; confidence: number | null };

async function callGeocoder(query: string, timeoutMs: number): Promise<Resolved | null> {
  const url = new URL('search', `${serverEnv.GEOCODER_BASE_URL.replace(/\/+$/, '')}/`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', query);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': serverEnv.GEOCODER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ExternalServiceError('geocoder.unreachable', 'The geocoder is unreachable right now.', { cause: error });
  }
  if (!response.ok) {
    throw new ExternalServiceError('geocoder.error', 'The geocoder answered with an error.');
  }
  const parsed = resultSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ExternalServiceError('geocoder.unexpected_response', 'The geocoder answered in an unexpected format.', {
      cause: parsed.error,
    });
  }
  const [first] = parsed.data;
  if (!first) return null;
  const address = first.address ?? {};
  return {
    lat: first.lat,
    lon: first.lon,
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? address.state ?? null,
    countryCode: address.country_code?.toUpperCase() ?? null,
    confidence: first.importance ?? null,
  };
}

export type ResolveOptions = {
  /** Epoch ms the caller must finish by. */
  deadline: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  db?: Db;
};

export type ResolveReport = { resolved: number; unresolvable: number; failed: number };

type StepResult = 'resolved' | 'unresolvable' | 'failed' | 'empty';

/**
 * Resolves one pending location while holding the single `geocoder_lock` row, so the
 * whole app makes at most one geocoder request per `geocoder.minIntervalMs`
 * (CLAUDE.md §2.5, §6.8). The timestamp is committed even when the request fails.
 */
async function resolveOne(db: Db, minIntervalMs: number, timeoutMs: number, options: Required<Pick<ResolveOptions, 'now' | 'sleep'>>): Promise<StepResult> {
  return db.transaction(async (tx): Promise<StepResult> => {
    const [lock] = await tx.select().from(geocoderLock).where(eq(geocoderLock.id, 1)).for('update');
    const [pending] = await tx
      .select({ queryNorm: geocodeCache.queryNorm })
      .from(geocodeCache)
      .where(eq(geocodeCache.status, 'pending'))
      .orderBy(geocodeCache.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!pending) return 'empty';

    if (lock?.lastCallAt) {
      const waitMs = lock.lastCallAt.getTime() + minIntervalMs - options.now().getTime();
      if (waitMs > 0) await options.sleep(waitMs);
    }

    let outcome: StepResult;
    try {
      const result = await callGeocoder(pending.queryNorm, timeoutMs);
      if (result === null) {
        await tx
          .update(geocodeCache)
          .set({ status: 'unresolvable', provider: PROVIDER, fetchedAt: options.now() })
          .where(eq(geocodeCache.queryNorm, pending.queryNorm));
        outcome = 'unresolvable';
      } else {
        await tx
          .update(geocodeCache)
          .set({
            status: 'resolved',
            lat: result.lat,
            lon: result.lon,
            city: result.city,
            countryCode: result.countryCode,
            timezone: timezoneAt(result.lat, result.lon),
            confidence: result.confidence,
            provider: PROVIDER,
            fetchedAt: options.now(),
          })
          .where(eq(geocodeCache.queryNorm, pending.queryNorm));
        outcome = 'resolved';
      }
    } catch (error) {
      // The row stays pending and is tried again on a later run; move it to the back of the queue.
      getLogger().warn({ err: error }, 'geocoder request failed');
      await tx.update(geocodeCache).set({ createdAt: sql`now()` }).where(eq(geocodeCache.queryNorm, pending.queryNorm));
      outcome = 'failed';
    }
    await tx.update(geocoderLock).set({ lastCallAt: options.now() }).where(eq(geocoderLock.id, 1));
    return outcome;
  });
}

/**
 * Works through the pending queue one location at a time until it is empty or the
 * deadline is near. At most `floor(remaining budget / geocoder.minIntervalMs)` requests are made.
 */
export async function resolvePendingLocations(options: ResolveOptions): Promise<ResolveReport> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const [minIntervalMs, timeoutMs] = await Promise.all([
    getSetting('geocoder.minIntervalMs', db),
    getSetting('sources.requestTimeoutMs', db),
  ]);

  const report: ResolveReport = { resolved: 0, unresolvable: 0, failed: 0 };
  const budget = Math.floor(Math.max(0, options.deadline - Date.now()) / Math.max(minIntervalMs, 1));
  for (let step = 0; step < budget; step += 1) {
    if (Date.now() + minIntervalMs > options.deadline) break;
    const result = await resolveOne(db, minIntervalMs, timeoutMs, { now, sleep });
    if (result === 'empty') break;
    report[result] += 1;
    // A failing geocoder is not hammered: stop and let the next run try again.
    if (result === 'failed') break;
  }
  return report;
}
