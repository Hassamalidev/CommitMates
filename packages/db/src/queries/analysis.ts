import { and, eq, gt, gte, isNull } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { analysisCache, toolSessions } from '../schema';

export type AnalysisKey = { kind: string; subjectKey: string; paramsHash: string };

export type CachedAnalysis = { result: unknown; computedAt: Date; expiresAt: Date; isMemberSubject: boolean };

/** A stored tool result that has not expired yet (CLAUDE.md §5.3 step 3, §5.8). */
export async function getCachedAnalysis(key: AnalysisKey, now: Date, db: DbOrTx = getDb()): Promise<CachedAnalysis | null> {
  const [row] = await db
    .select({
      result: analysisCache.result,
      computedAt: analysisCache.computedAt,
      expiresAt: analysisCache.expiresAt,
      isMemberSubject: analysisCache.isMemberSubject,
    })
    .from(analysisCache)
    .where(
      and(
        eq(analysisCache.kind, key.kind),
        eq(analysisCache.subjectKey, key.subjectKey),
        eq(analysisCache.paramsHash, key.paramsHash),
        gt(analysisCache.expiresAt, now),
      ),
    );
  return row ?? null;
}

export type AnalysisInput = AnalysisKey & { result: unknown; isMemberSubject: boolean; computedAt: Date; expiresAt: Date };

/** Stores a tool result, replacing an earlier one for the same subject and parameters. */
export async function putCachedAnalysis(input: AnalysisInput, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(analysisCache)
    .values(input)
    .onConflictDoUpdate({
      target: [analysisCache.kind, analysisCache.subjectKey, analysisCache.paramsHash],
      set: {
        result: input.result,
        isMemberSubject: input.isMemberSubject,
        computedAt: input.computedAt,
        expiresAt: input.expiresAt,
      },
    });
}

/** One row per tool run for the tool-conversion metric. The IP is already a salted daily hash. */
export async function recordToolSession(
  session: { tool: string; ipHashDay: string; userId?: string | undefined },
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.insert(toolSessions).values({ tool: session.tool, ipHashDay: session.ipHashDay, userId: session.userId ?? null });
}

/** The window in which a sign-up counts as a tool conversion (CLAUDE.md §1.7). */
const CONVERSION_WINDOW_MS = 24 * 60 * 60 * 1000; // allowed-literal: "within 24 hours" (§1.7)

/**
 * Credits a new member's sign-up to the anonymous tool runs from the same daily IP hash
 * in the previous 24 hours (the tool-conversion metric, CLAUDE.md §1.7). Only today's
 * salt still exists, so runs before midnight cannot be matched; the metric errs low.
 */
export async function markToolConversions(userId: string, ipHashDay: string, now: Date, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db
    .update(toolSessions)
    .set({ convertedUserId: userId })
    .where(
      and(
        eq(toolSessions.ipHashDay, ipHashDay),
        isNull(toolSessions.userId),
        isNull(toolSessions.convertedUserId),
        gte(toolSessions.createdAt, new Date(now.getTime() - CONVERSION_WINDOW_MS)),
      ),
    )
    .returning({ id: toolSessions.id });
  return rows.length;
}
