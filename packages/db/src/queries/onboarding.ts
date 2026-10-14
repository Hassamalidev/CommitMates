import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { departments, notificationPrefs, profiles } from '../schema';

export type Department = { id: string; name: string };

/** A university's departments (merged ones left out), by name, for the picker. */
export async function listDepartments(universityId: string, db: DbOrTx = getDb()): Promise<Department[]> {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.universityId, universityId), isNull(departments.mergedIntoId)))
    .orderBy(asc(departments.name));
}

/** Hops followed through `merged_into_id` before giving up on a cycle. */
const MAX_MERGE_HOPS = 10;

/** The department a merged one now lives in. */
async function followMerges(id: string, db: DbOrTx): Promise<Department | null> {
  let currentId = id;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
    const [row] = await db
      .select({ id: departments.id, name: departments.name, mergedIntoId: departments.mergedIntoId })
      .from(departments)
      .where(eq(departments.id, currentId));
    if (!row) return null;
    if (row.mergedIntoId === null) return { id: row.id, name: row.name };
    currentId = row.mergedIntoId;
  }
  return null;
}

/**
 * The existing department whose normalized name is most similar to `normalized` (pg_trgm),
 * if the similarity reaches `threshold`; merged departments resolve to where they were merged.
 */
export async function findSimilarDepartment(
  universityId: string,
  normalized: string,
  threshold: number,
  db: DbOrTx = getDb(),
): Promise<Department | null> {
  const rows = await db.execute<{ id: string }>(sql`
    select id from departments
    where university_id = ${universityId} and similarity(normalized_name, ${normalized}) >= ${threshold}
    order by similarity(normalized_name, ${normalized}) desc, created_at
    limit 1`);
  const id = rows[0]?.id;
  return id === undefined ? null : followMerges(id, db);
}

/** Creates a department, or returns the one with the same normalized name if it was just created. */
export async function insertDepartment(
  input: { universityId: string; name: string; normalizedName: string; createdBy: string },
  db: DbOrTx = getDb(),
): Promise<Department> {
  const [created] = await db.insert(departments).values(input).onConflictDoNothing().returning({ id: departments.id, name: departments.name });
  if (created) return created;
  const [existing] = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.universityId, input.universityId), eq(departments.normalizedName, input.normalizedName)));
  if (!existing) throw new Error('department was neither created nor found');
  return existing;
}

/** The department a member picked, if it belongs to that university. */
export async function getDepartment(id: string, universityId: string, db: DbOrTx = getDb()): Promise<Department | null> {
  const [row] = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.universityId, universityId)));
  return row ?? null;
}

/**
 * Which of `tags` exist in the tag vocabulary: GitHub topics and the tags derived from package
 * registries (CLAUDE.md §8 F10 step 7). Nothing is hand-listed.
 */
export async function knownTags(tags: readonly string[], db: DbOrTx = getDb()): Promise<Set<string>> {
  if (tags.length === 0) return new Set();
  const list = sql`array[${sql.join(
    tags.map((tag) => sql`${tag}`),
    sql`, `,
  )}]::text[]`;
  const rows = await db.execute<{ tag: string }>(sql`
    select slug as tag from topics where slug = any(${list})
    union
    select tag from package_meta, unnest(derived_tags) as tag where derived_tags && ${list} and tag = any(${list})`);
  return new Set(rows.map((row) => row.tag));
}

/** The most used tags in the vocabulary, as suggestions for learning goals. */
export async function popularTags(limit: number, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`
    select tag from (
      select unnest(derived_tags) as tag from package_meta
      union all
      select slug from topics
    ) as vocabulary
    group by tag
    order by count(*) desc, tag
    limit ${limit}`);
  return rows.map((row) => row.tag);
}

export type ProfileDetails = {
  role: 'student' | 'alumni' | 'supervisor_pending';
  gradYear: number | null;
  departmentId: string | null;
  learningGoals: string[];
  visibility: 'university' | 'country' | 'public' | 'hidden';
  shareTodayStatus: boolean;
  timezone: string;
  emailDigest: boolean;
};

/** Saves onboarding details and marks the member onboarded (the first time only). */
export async function saveProfileDetails(userId: string, details: ProfileDetails, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({
        role: details.role,
        gradYear: details.gradYear,
        departmentId: details.departmentId,
        learningGoals: details.learningGoals,
        visibility: details.visibility,
        shareTodayStatus: details.shareTodayStatus,
        timezone: details.timezone,
        onboardedAt: sql`coalesce(${profiles.onboardedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(profiles.userId, userId));
    await tx
      .insert(notificationPrefs)
      .values({ userId, emailDigest: details.emailDigest })
      .onConflictDoUpdate({ target: notificationPrefs.userId, set: { emailDigest: details.emailDigest } });
  });
}

/** The saved details, to prefill the form when a member edits them. */
export async function getProfileDetails(userId: string, db: DbOrTx = getDb()) {
  const [row] = await db
    .select({
      role: profiles.role,
      gradYear: profiles.gradYear,
      departmentId: profiles.departmentId,
      learningGoals: profiles.learningGoals,
      visibility: profiles.visibility,
      shareTodayStatus: profiles.shareTodayStatus,
      timezone: profiles.timezone,
      onboardedAt: profiles.onboardedAt,
      emailDigest: notificationPrefs.emailDigest,
    })
    .from(profiles)
    .leftJoin(notificationPrefs, eq(notificationPrefs.userId, profiles.userId))
    .where(eq(profiles.userId, userId));
  return row ?? null;
}
