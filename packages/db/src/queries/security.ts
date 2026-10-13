import { createHash, randomBytes } from 'node:crypto';

import { and, eq, lt, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { rateLimitBuckets, salts } from '../schema';
import { getSetting } from '../settings';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Bytes of randomness in a salt. */
const SALT_BYTES = 32;

export type SaltKind = (typeof salts.kind.enumValues)[number];

/** Whole days since the Unix epoch, in UTC. */
export function dayNumber(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
}

/** Takes `cost` tokens from a bucket through the `take_token` function. */
export async function takeToken(
  key: string,
  capacity: number,
  refillPerSec: number,
  cost = 1,
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(
    sql`select take_token(${key}, ${capacity}, ${refillPerSec}, ${cost}) as ok`,
  );
  return rows[0]?.ok === true;
}

/** Deletes buckets untouched for `olderThanMs`; they would be full again anyway. */
export async function deleteStaleBuckets(now: Date, olderThanMs: number, db: DbOrTx = getDb()): Promise<number> {
  const deleted = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.updatedAt, new Date(now.getTime() - olderThanMs)))
    .returning({ key: rateLimitBuckets.key });
  return deleted.length;
}

/** Returns the salt for a period, creating it on first use. Safe under concurrent callers. */
export async function getSalt(kind: SaltKind, period: number, db: DbOrTx = getDb()): Promise<Buffer> {
  await db
    .insert(salts)
    .values({ kind, period, salt: randomBytes(SALT_BYTES) })
    .onConflictDoNothing();
  const [row] = await db
    .select({ salt: salts.salt })
    .from(salts)
    .where(and(eq(salts.kind, kind), eq(salts.period, period)));
  if (!row) throw new Error(`salt ${kind}:${period} vanished`);
  return row.salt;
}

function saltedHash(value: string, salt: Buffer): string {
  return createHash('sha256').update(value).update(salt).digest('hex');
}

/**
 * `sha256(ip + daily_salt)`: the only form in which an IP address is ever kept
 * (CLAUDE.md §2.6). The salt is deleted the next day, so the hash cannot be reversed
 * or linked across days.
 */
export async function hashIp(ip: string, now: Date, db: DbOrTx = getDb()): Promise<string> {
  return saltedHash(ip, await getSalt('ip', dayNumber(now), db));
}

export async function aggregateSaltPeriod(now: Date, db: DbOrTx = getDb()): Promise<number> {
  const rotationDays = await getSetting('privacy.aggregateSaltRotationDays', db);
  return Math.floor(dayNumber(now) / rotationDays);
}

/**
 * Dedupe key for anonymous samples (CLAUDE.md §5.12): one person counts once per salt
 * period, and the hash cannot be linked back once the salt is rotated out.
 */
export async function hashSubject(
  githubId: number,
  now: Date,
  db: DbOrTx = getDb(),
): Promise<{ subjectHash: string; saltPeriod: number }> {
  const saltPeriod = await aggregateSaltPeriod(now, db);
  return { subjectHash: saltedHash(String(githubId), await getSalt('aggregate', saltPeriod, db)), saltPeriod };
}

/** Creates the current salts and deletes every older one. */
export async function rotateSalts(now: Date, db: DbOrTx = getDb()): Promise<{ deleted: number }> {
  const today = dayNumber(now);
  const period = await aggregateSaltPeriod(now, db);
  await getSalt('ip', today, db);
  await getSalt('aggregate', period, db);
  const deletedIp = await db
    .delete(salts)
    .where(and(eq(salts.kind, 'ip'), lt(salts.period, today)))
    .returning({ period: salts.period });
  const deletedAggregate = await db
    .delete(salts)
    .where(and(eq(salts.kind, 'aggregate'), lt(salts.period, period)))
    .returning({ period: salts.period });
  return { deleted: deletedIp.length + deletedAggregate.length };
}
