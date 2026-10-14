import { and, eq, gt } from 'drizzle-orm';

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
