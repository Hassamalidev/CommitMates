import { sql, type SQL } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { trustScores } from '../schema';

export type TrustInputRow = {
  userId: string;
  accountAgeDays: number;
  verified: boolean;
  sent: number;
  accepted: number;
  distinctReporters: number;
};

/**
 * A report counts toward trust and auto-hide when its reporter is verified, it falls in the window,
 * and a moderator has not dismissed it. Each reporter counts once (CLAUDE.md §8 F12).
 */
const countedReporters = (target: SQL, since: Date) => sql`
  (select count(distinct r.reporter)::int from reports r
   join profiles rp on rp.user_id = r.reporter
   where r.target_user = ${target} and r.created_at >= ${since.toISOString()}::timestamptz
     and rp.verified_at is not null and r.status <> 'dismissed')`;

/** What the trust score is computed from, for every member with a profile (§8 F12 "Trust score"). */
export async function trustInputs(now: Date, requestsSince: Date, reportsSince: Date, db: DbOrTx = getDb()): Promise<TrustInputRow[]> {
  const rows = await db.execute<{
    user_id: string;
    // numeric: postgres.js returns it as a string.
    age_days: string;
    verified: boolean;
    sent: number;
    accepted: number;
    reporters: number;
  }>(sql`
    select u.id as user_id,
           extract(epoch from (${now.toISOString()}::timestamptz - u.created_at)) / 86400 as age_days,
           p.verified_at is not null as verified,
           (select count(*)::int from message_requests m where m.from_user = u.id and m.created_at >= ${requestsSince.toISOString()}::timestamptz) as sent,
           (select count(*)::int from message_requests m
            where m.from_user = u.id and m.created_at >= ${requestsSince.toISOString()}::timestamptz and m.status = 'accepted') as accepted,
           ${countedReporters(sql`u.id`, reportsSince)} as reporters
    from users u
    join profiles p on p.user_id = u.id
    order by u.id`);
  return rows.map((row) => ({
    userId: row.user_id,
    accountAgeDays: Number(row.age_days),
    verified: row.verified,
    sent: row.sent,
    accepted: row.accepted,
    distinctReporters: row.reporters,
  }));
}

/** Distinct verified reporters of one member whose reports count (see `countedReporters`). */
export async function countDistinctReporters(targetUserId: string, since: Date, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute<{ reporters: number }>(sql`select ${countedReporters(sql`${targetUserId}::uuid`, since)} as reporters`);
  return rows[0]?.reporters ?? 0;
}

export type TrustScoreRow = { userId: string; score: number; multiplier: number; components: Record<string, number> };

/** Stores the nightly trust scores. */
export async function saveTrustScores(rows: readonly TrustScoreRow[], now: Date, db: DbOrTx = getDb()): Promise<void> {
  const BATCH = 500; // allowed-literal: rows per statement, well under the parameter limit
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH).map((row) => ({ ...row, computedAt: now }));
    await db
      .insert(trustScores)
      .values(batch)
      .onConflictDoUpdate({
        target: trustScores.userId,
        set: { score: sql`excluded.score`, multiplier: sql`excluded.multiplier`, components: sql`excluded.components`, computedAt: sql`excluded.computed_at` },
      });
  }
}
