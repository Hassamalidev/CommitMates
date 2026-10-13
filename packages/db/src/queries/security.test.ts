import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useTestDatabase, withSettings, type TestDatabase } from '../testing';

import {
  aggregateSaltPeriod,
  dayNumber,
  deleteStaleBuckets,
  getSalt,
  hashIp,
  hashSubject,
  rotateSalts,
  takeToken,
} from './security';

let database: TestDatabase;
const DAY_1 = new Date('2026-10-14T23:59:59.000Z');
const DAY_2 = new Date('2026-10-15T00:00:01.000Z');

beforeAll(async () => {
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
});
beforeEach(async () => {
  await database.sql`delete from salts`;
  await database.sql`delete from rate_limit_buckets`;
});

describe('takeToken', () => {
  it('exhausts and refills a bucket', async () => {
    expect(await takeToken('k', 2, 0)).toBe(true);
    expect(await takeToken('k', 2, 0)).toBe(true);
    expect(await takeToken('k', 2, 0)).toBe(false);
    await database.sql`update rate_limit_buckets set updated_at = updated_at - interval '30 seconds' where key = 'k'`;
    // 30 s × 0.1 tokens per second = 3 tokens, capped at the capacity of 2.
    expect(await takeToken('k', 2, 0.1)).toBe(true);
    expect(await takeToken('k', 2, 0)).toBe(true);
    expect(await takeToken('k', 2, 0)).toBe(false);
  });

  it('never goes below zero under concurrent callers', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => takeToken('race', 10, 0)));
    expect(results.filter(Boolean)).toHaveLength(10);
    const [row] = await database.sql`select tokens from rate_limit_buckets where key = 'race'`;
    expect(row!.tokens).toBe(0);
  });
});

describe('deleteStaleBuckets', () => {
  it('removes only buckets untouched for the given time', async () => {
    await takeToken('fresh', 5, 1);
    await takeToken('stale', 5, 1);
    await database.sql`update rate_limit_buckets set updated_at = now() - interval '2 days' where key = 'stale'`;
    expect(await deleteStaleBuckets(new Date(), 24 * 60 * 60 * 1000)).toBe(1);
    const rows = await database.sql`select key from rate_limit_buckets`;
    expect(rows.map((row) => row.key)).toEqual(['fresh']);
  });
});

describe('salts and hashing', () => {
  it('counts UTC days', () => {
    expect(dayNumber(DAY_2) - dayNumber(DAY_1)).toBe(1);
    expect(dayNumber(new Date('1970-01-02T00:00:00.000Z'))).toBe(1);
  });

  it('returns one stable salt per period, even under concurrent creation', async () => {
    const salts = await Promise.all(Array.from({ length: 8 }, () => getSalt('ip', 100)));
    expect(new Set(salts.map((salt) => salt.toString('hex'))).size).toBe(1);
    expect(salts[0]).toHaveLength(32);
    expect((await getSalt('ip', 101)).equals(salts[0]!)).toBe(false);
    expect((await getSalt('aggregate', 100)).equals(salts[0]!)).toBe(false);
  });

  it('hashes an IP the same way within a day and differently the next day', async () => {
    const first = await hashIp('203.0.113.7', DAY_1);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('203');
    expect(await hashIp('203.0.113.7', DAY_1)).toBe(first);
    expect(await hashIp('203.0.113.8', DAY_1)).not.toBe(first);
    expect(await hashIp('203.0.113.7', DAY_2)).not.toBe(first);
  });

  it('hashes a subject once per aggregate period', async () => {
    const a = await hashSubject(583231, DAY_1);
    const b = await hashSubject(583231, DAY_2);
    expect(a.saltPeriod).toBe(await aggregateSaltPeriod(DAY_1));
    expect(b).toEqual(a);
    expect((await hashSubject(1, DAY_1)).subjectHash).not.toBe(a.subjectHash);

    const later = new Date(DAY_1.getTime() + 31 * 24 * 60 * 60 * 1000);
    const c = await hashSubject(583231, later);
    expect(c.saltPeriod).toBe(a.saltPeriod + 1);
    expect(c.subjectHash).not.toBe(a.subjectHash);
  });

  it('follows privacy.aggregateSaltRotationDays', async () => {
    const period = await withSettings({ 'privacy.aggregateSaltRotationDays': 1 }, () => aggregateSaltPeriod(DAY_1));
    expect(period).toBe(dayNumber(DAY_1));
  });
});

describe('rotateSalts', () => {
  it('keeps the current salts and deletes older ones, making old hashes unrepeatable', async () => {
    const yesterdayHash = await hashIp('203.0.113.7', DAY_1);
    const subject = await hashSubject(42, DAY_1);
    await getSalt('aggregate', subject.saltPeriod - 1);

    const result = await rotateSalts(DAY_2);
    expect(result.deleted).toBe(2);
    const rows = await database.sql`select kind, period from salts order by kind`;
    expect(rows).toEqual([
      { kind: 'ip', period: dayNumber(DAY_2) },
      { kind: 'aggregate', period: subject.saltPeriod },
    ]);

    // A new salt is generated for the old day, so the old hash cannot be reproduced.
    expect(await hashIp('203.0.113.7', DAY_1)).not.toBe(yesterdayHash);
    expect((await hashSubject(42, DAY_2)).subjectHash).toBe(subject.subjectHash);
  });
});
