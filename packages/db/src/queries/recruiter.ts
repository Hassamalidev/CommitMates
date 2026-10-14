import { desc, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { genericMessageCounts, recruiterReports, type StoredSecretFinding } from '../schema';

/** The `limit` most frequent normalized short commit messages: the generic ones. */
export async function topGenericMessages(limit: number, db: DbOrTx = getDb()): Promise<Set<string>> {
  if (limit <= 0) return new Set();
  const rows = await db
    .select({ message: genericMessageCounts.message })
    .from(genericMessageCounts)
    .orderBy(desc(genericMessageCounts.count), genericMessageCounts.message)
    .limit(limit);
  return new Set(rows.map((row) => row.message));
}

/** Counts each distinct message once for this analysis. Messages carry no link to anyone. */
export async function countGenericMessages(messages: Iterable<string>, db: DbOrTx = getDb()): Promise<void> {
  const distinct = [...new Set(messages)].filter((message) => message !== '');
  if (distinct.length === 0) return;
  await db
    .insert(genericMessageCounts)
    .values(distinct.map((message) => ({ message, count: 1 })))
    .onConflictDoUpdate({ target: genericMessageCounts.message, set: { count: sql`${genericMessageCounts.count} + 1` } });
}

export type RecruiterReportInput = {
  userId: string;
  subjectGithubId: number;
  score: number | null;
  rules: unknown;
  secretFindings: StoredSecretFinding[];
  secretScanPartial: boolean;
  filesScanned: number;
  computedAt: Date;
};

export async function insertRecruiterReport(report: RecruiterReportInput, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(recruiterReports).values(report);
}

export type LatestSecretScan = {
  findings: StoredSecretFinding[];
  partial: boolean;
  filesScanned: number;
  computedAt: Date;
};

/** A member's most recent secret scan of their own account, or `null`. Callers check that the viewer is that member. */
export async function latestSecretScan(userId: string, db: DbOrTx = getDb()): Promise<LatestSecretScan | null> {
  const [row] = await db
    .select({
      findings: recruiterReports.secretFindings,
      partial: recruiterReports.secretScanPartial,
      filesScanned: recruiterReports.filesScanned,
      computedAt: recruiterReports.computedAt,
    })
    .from(recruiterReports)
    .where(eq(recruiterReports.userId, userId))
    .orderBy(desc(recruiterReports.computedAt))
    .limit(1);
  return row ?? null;
}
