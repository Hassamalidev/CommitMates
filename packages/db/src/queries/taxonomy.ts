import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { repoDependencies, taxonomyExpansions, topicGlobalCounts, topics, type TaxonomyItem } from '../schema';

export type TopicSeed = { slug: string; aliases: string[]; related: string[] };

/** The topic a term names, by slug or by one of its aliases; `null` when there is none. */
export async function findTopic(slug: string, db: DbOrTx = getDb()): Promise<TopicSeed | null> {
  const [exact] = await db.select({ slug: topics.slug, aliases: topics.aliases, related: topics.related }).from(topics).where(eq(topics.slug, slug));
  if (exact) return exact;
  const [byAlias] = await db
    .select({ slug: topics.slug, aliases: topics.aliases, related: topics.related })
    .from(topics)
    .where(sql`${slug} = any(${topics.aliases})`)
    .limit(1);
  return byAlias ?? null;
}

/** Cached repository counts of topics fetched after `freshAfter`. */
export async function getTopicCounts(slugs: readonly string[], freshAfter: Date, db: DbOrTx = getDb()): Promise<Map<string, number>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({ slug: topicGlobalCounts.slug, totalCount: topicGlobalCounts.totalCount })
    .from(topicGlobalCounts)
    .where(and(inArray(topicGlobalCounts.slug, [...slugs]), gt(topicGlobalCounts.fetchedAt, freshAfter)));
  return new Map(rows.map((row) => [row.slug, row.totalCount]));
}

export async function putTopicCount(slug: string, totalCount: number, fetchedAt: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(topicGlobalCounts)
    .values({ slug, totalCount, fetchedAt })
    .onConflictDoUpdate({ target: topicGlobalCounts.slug, set: { totalCount, fetchedAt } });
}

/** Repositories in our corpus that use each package (any ecosystem), and how many repositories the corpus has. */
export async function dependencyUsage(names: readonly string[], db: DbOrTx = getDb()): Promise<{ counts: Map<string, number>; corpus: number }> {
  const [corpusRow] = await db.select({ corpus: sql<number>`count(distinct ${repoDependencies.repoGithubId})::int` }).from(repoDependencies);
  if (names.length === 0) return { counts: new Map(), corpus: corpusRow?.corpus ?? 0 };
  const rows = await db
    .select({ name: repoDependencies.packageName, count: sql<number>`count(distinct ${repoDependencies.repoGithubId})::int` })
    .from(repoDependencies)
    .where(inArray(repoDependencies.packageName, [...names]))
    .groupBy(repoDependencies.packageName);
  return { counts: new Map(rows.map((row) => [row.name, row.count])), corpus: corpusRow?.corpus ?? 0 };
}

export type StoredExpansion = { term: string; slug: string; items: TaxonomyItem[]; sampleSize: number; computedAt: Date };

/** A cached expansion that has not expired. */
export async function getExpansion(term: string, now: Date, db: DbOrTx = getDb()): Promise<StoredExpansion | null> {
  const [row] = await db
    .select({
      term: taxonomyExpansions.term,
      slug: taxonomyExpansions.slug,
      items: taxonomyExpansions.items,
      sampleSize: taxonomyExpansions.sampleSize,
      computedAt: taxonomyExpansions.computedAt,
    })
    .from(taxonomyExpansions)
    .where(and(eq(taxonomyExpansions.term, term), gt(taxonomyExpansions.expiresAt, now)));
  return row ?? null;
}

export async function putExpansion(expansion: StoredExpansion & { expiresAt: Date }, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(taxonomyExpansions)
    .values(expansion)
    .onConflictDoUpdate({
      target: taxonomyExpansions.term,
      set: { slug: expansion.slug, items: expansion.items, sampleSize: expansion.sampleSize, computedAt: expansion.computedAt, expiresAt: expansion.expiresAt },
    });
}
