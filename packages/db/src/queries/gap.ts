import { inArray } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { gapReports, repoPaths, topics } from '../schema';

/** Replaces a repository's structure features (CLAUDE.md §8 F5 step 1). */
export async function replaceRepoPaths(repoGithubId: number, features: readonly string[], db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(repoPaths).where(inArray(repoPaths.repoGithubId, [repoGithubId]));
    const distinct = [...new Set(features)];
    if (distinct.length > 0) await tx.insert(repoPaths).values(distinct.map((pathFeature) => ({ repoGithubId, pathFeature })));
  });
}

export type TopicNames = { displayNames: Map<string, string>; aliasToSlug: Map<string, string> };

/** Display names of topics and the slug each alias points to, for labelling facets. */
export async function topicNames(db: DbOrTx = getDb()): Promise<TopicNames> {
  const rows = await db.select({ slug: topics.slug, displayName: topics.displayName, aliases: topics.aliases }).from(topics);
  const displayNames = new Map(rows.map((row) => [row.slug, row.displayName]));
  const aliasToSlug = new Map<string, string>();
  for (const row of rows) for (const alias of row.aliases) aliasToSlug.set(alias, row.slug);
  for (const row of rows) aliasToSlug.set(row.slug, row.slug);
  return { displayNames, aliasToSlug };
}

export type GapReportInput = typeof gapReports.$inferInsert;

export async function insertGapReport(report: GapReportInput, db: DbOrTx = getDb()): Promise<void> {
  await db.insert(gapReports).values(report);
}
