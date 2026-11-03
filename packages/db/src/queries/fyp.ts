import { and, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { fypProjects, legacyEntries } from '../schema';

export type FypProjectRow = typeof fypProjects.$inferSelect;

/**
 * Records a member's final-year project at their university, confirmed (§8 F22 "Past projects
 * corpus"): a submission, or the owner confirming a detected one. A repository already recorded at
 * the university is updated in place.
 */
export async function upsertConfirmedProject(
  project: { universityId: string; repoGithubId: number; ownerUserId: string; year: number | null; submittedBy: string; corpusText: string | null },
  db: DbOrTx = getDb(),
): Promise<string> {
  const [row] = await db
    .insert(fypProjects)
    .values({ ...project, autoDetected: false, confirmed: true })
    .onConflictDoUpdate({
      target: [fypProjects.universityId, fypProjects.repoGithubId],
      set: { ownerUserId: project.ownerUserId, year: project.year, confirmed: true, dismissedAt: null, corpusText: sql`coalesce(excluded.corpus_text, ${fypProjects.corpusText})` },
    })
    .returning({ id: fypProjects.id });
  if (!row) throw new Error('fyp project upsert returned no row');
  return row.id;
}

/** A detected project waiting for its owner; repositories already recorded are left alone. */
export async function insertDetectedProject(
  project: { universityId: string; repoGithubId: number; ownerUserId: string; corpusText: string },
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const rows = await db
    .insert(fypProjects)
    .values({ ...project, autoDetected: true, confirmed: false })
    .onConflictDoNothing()
    .returning({ id: fypProjects.id });
  return rows.length > 0;
}

export async function getFypProject(projectId: string, db: DbOrTx = getDb()): Promise<FypProjectRow | null> {
  const [row] = await db.select().from(fypProjects).where(eq(fypProjects.id, projectId));
  return row ?? null;
}

export async function confirmFypProject(projectId: string, year: number | null, db: DbOrTx = getDb()): Promise<void> {
  await db.update(fypProjects).set({ confirmed: true, year, dismissedAt: null }).where(eq(fypProjects.id, projectId));
}

export async function dismissFypProject(projectId: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.update(fypProjects).set({ dismissedAt: now }).where(eq(fypProjects.id, projectId));
}

/** Removes a project and the Senior's Legacy entry it fed. */
export async function deleteFypProject(project: Pick<FypProjectRow, 'id' | 'ownerUserId' | 'repoGithubId'>, db: DbOrTx = getDb()): Promise<void> {
  await db.delete(fypProjects).where(eq(fypProjects.id, project.id));
  if (project.ownerUserId) {
    await db
      .delete(legacyEntries)
      .where(and(eq(legacyEntries.ownerUserId, project.ownerUserId), eq(legacyEntries.repoGithubId, project.repoGithubId), eq(legacyEntries.source, 'fyp')));
  }
}

/** Repository ids a university already records (any state), so detection never proposes them again. */
export async function recordedRepoIds(universityId: string, db: DbOrTx = getDb()): Promise<Set<number>> {
  const rows = await db.execute<{ repo_github_id: string }>(sql`select repo_github_id from fyp_projects where university_id = ${universityId}`);
  return new Set(rows.map((row) => Number(row.repo_github_id)));
}

export type OwnFypProject = FypProjectRow & { fullName: string | null; description: string | null };

/** A member's own projects at their university: confirmed ones and detections waiting for them. */
export async function ownFypProjects(userId: string, db: DbOrTx = getDb()): Promise<OwnFypProject[]> {
  const rows = await db.execute<{ id: string; full_name: string | null; description: string | null }>(sql`
    select p.id, r.full_name, r.description from fyp_projects p left join gh_repos r on r.github_id = p.repo_github_id
    where p.owner_user_id = ${userId} and p.dismissed_at is null
    order by p.confirmed, p.created_at desc`);
  if (rows.length === 0) return [];
  const projects = await db.select().from(fypProjects).where(eq(fypProjects.ownerUserId, userId));
  const byId = new Map(projects.map((project) => [project.id, project]));
  return rows.flatMap((row) => {
    const project = byId.get(row.id);
    return project ? [{ ...project, fullName: row.full_name, description: row.description }] : [];
  });
}

/** Confirmed projects of a university with corpus text, for duplicate checks. */
export async function universityCorpus(universityId: string, db: DbOrTx = getDb()) {
  const rows = await db.execute<{ id: string; full_name: string | null; description: string | null; year: number | null; corpus_text: string }>(sql`
    select p.id, r.full_name, r.description, p.year, p.corpus_text
    from fyp_projects p left join gh_repos r on r.github_id = p.repo_github_id
    where p.university_id = ${universityId} and p.confirmed and p.corpus_text is not null
    order by p.id`);
  return rows.map((row) => ({ id: row.id, fullName: row.full_name, description: row.description, year: row.year, corpusText: row.corpus_text }));
}

export async function countConfirmedProjects(universityId: string, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db.execute<{ count: string }>(sql`select count(*) as count from fyp_projects where university_id = ${universityId} and confirmed`);
  return Number(row?.count ?? 0);
}

/** Records a Senior's Legacy entry fed by a final-year project; an existing entry for the repository is kept (§8 F17). */
export async function addFypLegacyEntry(
  entry: { universityId: string; ownerUserId: string; repoGithubId: number; gradYear: number | null; tags: string[] },
  db: DbOrTx = getDb(),
): Promise<void> {
  await db
    .insert(legacyEntries)
    .values({ ...entry, source: 'fyp', blurb: null, acceptsQuestions: false })
    .onConflictDoNothing();
}
