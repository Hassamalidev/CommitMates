import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { blocks, feedback, githubIdentities, messageRequests, reports, trustScores, users } from '../schema';

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

/** Records that `blocker` blocked `blocked`; repeated blocks are ignored. */
export async function insertBlock(blocker: string, blocked: string, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(blocks).values({ blocker, blocked }).onConflictDoNothing();
}

/** Removes a block; false when there was none. */
export async function deleteBlock(blocker: string, blocked: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .delete(blocks)
    .where(and(eq(blocks.blocker, blocker), eq(blocks.blocked, blocked)))
    .returning({ blocked: blocks.blocked });
  return rows.length > 0;
}

/** Whether `blocker` has blocked `blocked` (one direction only). */
export async function hasBlocked(blocker: string, blocked: string, db: DbOrTx = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ blocked: blocks.blocked })
    .from(blocks)
    .where(and(eq(blocks.blocker, blocker), eq(blocks.blocked, blocked)));
  return row !== undefined;
}

/** People a member has blocked, newest first. */
export async function listBlocked(blocker: string, db: DbOrTx = getDb()): Promise<{ userId: string; login: string; name: string | null; blockedAt: Date }[]> {
  return db
    .select({ userId: blocks.blocked, login: githubIdentities.login, name: githubIdentities.name, blockedAt: blocks.createdAt })
    .from(blocks)
    .innerJoin(githubIdentities, eq(githubIdentities.userId, blocks.blocked))
    .where(eq(blocks.blocker, blocker))
    .orderBy(desc(blocks.createdAt));
}

/** Declines pending requests between two members, both ways; a block ends them silently. */
export async function declinePendingBetween(a: string, b: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(messageRequests)
    .set({ status: 'declined', respondedAt: now })
    .where(
      and(
        eq(messageRequests.status, 'pending'),
        or(and(eq(messageRequests.fromUser, a), eq(messageRequests.toUser, b)), and(eq(messageRequests.fromUser, b), eq(messageRequests.toUser, a))),
      ),
    );
}

/**
 * The author of a message the reporter can see: it must be in a thread the reporter belongs to.
 * Null otherwise, so nobody can report (or learn about) messages outside their own threads.
 */
export async function reportableMessageAuthor(messageId: string, reporterId: string, db: DbOrTx = getDb()): Promise<string | null> {
  const rows = await db.execute<{ author_user_id: string | null }>(sql`
    select m.author_user_id from messages m
    join thread_members tm on tm.thread_id = m.thread_id and tm.user_id = ${reporterId}
    where m.id = ${messageId} and m.kind = 'user'`);
  return rows[0]?.author_user_id ?? null;
}

export type NewReport = {
  reporter: string;
  targetUser: string;
  targetMessage: string | null;
  reason: 'spam' | 'harassment' | 'impersonation' | 'inappropriate' | 'other';
  details: string | null;
};

export async function insertReport(report: NewReport, db: DbOrTx = getDb()): Promise<string> {
  const [row] = await db.insert(reports).values(report).returning({ id: reports.id });
  if (!row) throw new Error('report insert returned no row');
  return row.id;
}

/** Hides an active account pending review; false when it was not active (already hidden, suspended). */
export async function hideForReview(userId: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ status: 'hidden_pending_review' })
    .where(and(eq(users.id, userId), eq(users.status, 'active')))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Stores feedback text with the page it was sent from. */
export async function insertFeedback(entry: { userId: string | null; page: string; body: string }, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(feedback).values(entry);
}
