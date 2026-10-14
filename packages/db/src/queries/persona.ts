import { eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { githubIdentities, languages, packageMeta, profiles } from '../schema';
import type { SettingKey } from '../settings';

/** Linguist colors of the given languages; languages without a color are left out. */
export async function getLanguageColors(names: readonly string[], db: DbOrTx = getDb()): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();
  const rows = await db
    .select({ name: languages.name, color: languages.color })
    .from(languages)
    .where(inArray(languages.name, [...names]));
  const colors = new Map<string, string>();
  for (const row of rows) if (row.color) colors.set(row.name, row.color);
  return colors;
}

/** Derived tags of packages, keyed `<ecosystem>:<name>`. Packages not enriched yet are absent. */
export async function getPackageTags(
  refs: readonly { ecosystem: string; name: string }[],
  db: DbOrTx = getDb(),
): Promise<Map<string, string[]>> {
  const tags = new Map<string, string[]>();
  if (refs.length === 0) return tags;
  const names = [...new Set(refs.map((ref) => ref.name))];
  const wanted = new Set(refs.map((ref) => `${ref.ecosystem}:${ref.name}`));
  const rows = await db
    .select({ ecosystem: packageMeta.ecosystem, name: packageMeta.name, derivedTags: packageMeta.derivedTags })
    .from(packageMeta)
    .where(inArray(packageMeta.name, names));
  for (const row of rows) {
    const key = `${row.ecosystem}:${row.name}`;
    if (wanted.has(key)) tags.set(key, row.derivedTags);
  }
  return tags;
}

export type MemberProfile = {
  userId: string;
  login: string;
  timezone: string;
  visibility: (typeof profiles.$inferSelect)['visibility'];
};

/** The member behind a GitHub account, with the profile fields analyses need; `null` for non-members. */
export async function getMemberProfileByGithubId(githubId: number, db: DbOrTx = getDb()): Promise<MemberProfile | null> {
  const [row] = await db
    .select({
      userId: githubIdentities.userId,
      login: githubIdentities.login,
      timezone: profiles.timezone,
      visibility: profiles.visibility,
    })
    .from(githubIdentities)
    .innerJoin(profiles, eq(profiles.userId, githubIdentities.userId))
    .where(eq(githubIdentities.githubId, githubId));
  return row ?? null;
}

/**
 * Percentile rank of `value` among the anonymous samples of a metric, in [0, 1]. `null`
 * until the metric holds as many samples as `min_sample` of the setting it feeds
 * (0 there means "never computed").
 */
export async function metricRank(
  metricKey: string,
  value: number,
  minSampleOf: SettingKey,
  db: DbOrTx = getDb(),
): Promise<number | null> {
  const rows = await db.execute<{ total: number; below: number; equal: number; min_sample: number | null }>(sql`
    select count(*)::int as total,
           (count(*) filter (where value < ${value}))::int as below,
           (count(*) filter (where value = ${value}))::int as equal,
           (select min_sample from settings where key = ${minSampleOf}) as min_sample
    from metric_samples where metric_key = ${metricKey}`);
  const row = rows[0];
  const minSample = row?.min_sample ?? 0;
  if (!row || minSample <= 0 || row.total < minSample) return null;
  return (row.below + row.equal * 0.5) / row.total;
}

/** Every language name Linguist knows, alphabetically. */
export async function listLanguages(db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.select({ name: languages.name }).from(languages).orderBy(languages.name);
  return rows.map((row) => row.name);
}
