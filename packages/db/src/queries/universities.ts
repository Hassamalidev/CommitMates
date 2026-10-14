import { desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { disposableDomains, universities, universityDomains } from '../schema';

export type UniversityMatch = { id: string; name: string; slug: string; country: string; countryCode: string; domain: string };

/**
 * Universities whose registered domain is the longest of `suffixes` that has any match
 * (CLAUDE.md §6.4 "Matching rule"). `suffixes` are the email domain's label-boundary
 * suffixes; several rows come back only when universities share that domain.
 */
export async function findUniversitiesByDomainSuffixes(suffixes: readonly string[], db: DbOrTx = getDb()): Promise<UniversityMatch[]> {
  if (suffixes.length === 0) return [];
  const rows = await db
    .select({
      id: universities.id,
      name: universities.name,
      slug: universities.slug,
      country: universities.country,
      countryCode: universities.countryCode,
      domain: universityDomains.domain,
    })
    .from(universityDomains)
    .innerJoin(universities, eq(universities.id, universityDomains.universityId))
    .where(inArray(universityDomains.domain, [...suffixes]))
    .orderBy(desc(sql`length(${universityDomains.domain})`), universities.name);
  const longest = rows[0]?.domain;
  return rows.filter((row) => row.domain === longest);
}

/** Whether the domain or any parent domain is on the disposable blocklist (§8 F10 step 2). */
export async function isDisposableDomain(suffixes: readonly string[], db: DbOrTx = getDb()): Promise<boolean> {
  if (suffixes.length === 0) return false;
  const [row] = await db
    .select({ domain: disposableDomains.domain })
    .from(disposableDomains)
    .where(inArray(disposableDomains.domain, [...suffixes]))
    .limit(1);
  return row !== undefined;
}

export type UniversitySummary = { id: string; name: string; slug: string; country: string; countryCode: string; memberCount: number };

/** One university by id, for pages that show where a member is verified. */
export async function getUniversity(id: string, db: DbOrTx = getDb()): Promise<UniversitySummary | null> {
  const [row] = await db
    .select({
      id: universities.id,
      name: universities.name,
      slug: universities.slug,
      country: universities.country,
      countryCode: universities.countryCode,
      memberCount: universities.memberCount,
    })
    .from(universities)
    .where(eq(universities.id, id));
  return row ?? null;
}
