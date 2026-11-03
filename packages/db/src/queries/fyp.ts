import { and, eq, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { fypIdeas, fypInterest, fypProjects, fypSupervisors, legacyEntries, profiles } from '../schema';

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

// Supervisors (§8 F22 "Supervisors").

export type SupervisorRow = typeof fypSupervisors.$inferSelect;

/** Applies, or updates the areas of, a supervisor at a university; an approval already given is kept. */
export async function upsertSupervisorApplication(userId: string, universityId: string, areas: string[], db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(fypSupervisors)
    .values({ userId, universityId, areas })
    .onConflictDoUpdate({ target: [fypSupervisors.userId, fypSupervisors.universityId], set: { areas } });
}

export async function getSupervisor(userId: string, universityId: string, db: DbOrTx = getDb()): Promise<SupervisorRow | null> {
  const [row] = await db
    .select()
    .from(fypSupervisors)
    .where(and(eq(fypSupervisors.userId, userId), eq(fypSupervisors.universityId, universityId)));
  return row ?? null;
}

export async function approveSupervisor(userId: string, universityId: string, approvedBy: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(fypSupervisors)
    .set({ approvedAt: now, approvedBy })
    .where(and(eq(fypSupervisors.userId, userId), eq(fypSupervisors.universityId, universityId)));
  await db.update(profiles).set({ role: 'supervisor' }).where(eq(profiles.userId, userId));
}

export async function deleteSupervisorApplication(userId: string, universityId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.delete(fypSupervisors).where(and(eq(fypSupervisors.userId, userId), eq(fypSupervisors.universityId, universityId)));
}

export type SupervisorView = { userId: string; login: string | null; universityId: string; universityName: string; areas: string[]; approvedAt: Date | null; openIdeas: number };

/** Supervisors of universities (approved or waiting), with their open ideas; a `null` scope means every university. */
export async function supervisorsAt(universityIds: readonly string[] | null, approved: boolean, limit: number, db: DbOrTx = getDb()): Promise<SupervisorView[]> {
  const scope =
    universityIds === null
      ? sql``
      : universityIds.length === 0
        ? sql`and false`
        : sql`and s.university_id in (${sql.join(
            universityIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
  const rows = await db.execute<{ user_id: string; login: string | null; university_id: string; university_name: string; areas: string[]; approved_at: string | null; open_ideas: string }>(sql`
    select s.user_id, gi.login, s.university_id, u.name as university_name, s.areas, s.approved_at,
           (select count(*) from fyp_ideas i where i.author_user_id = s.user_id and i.supervisor_idea and i.status in ('open', 'team_forming')) as open_ideas
    from fyp_supervisors s
    join universities u on u.id = s.university_id
    join users m on m.id = s.user_id
    left join github_identities gi on gi.user_id = s.user_id
    where m.status = 'active' and (s.approved_at is not null) = ${approved} ${scope}
    order by s.created_at, s.user_id
    limit ${limit}`);
  return rows.map((row) => ({
    userId: row.user_id,
    login: row.login,
    universityId: row.university_id,
    universityName: row.university_name,
    areas: row.areas,
    approvedAt: row.approved_at === null ? null : new Date(row.approved_at),
    openIdeas: Number(row.open_ideas),
  }));
}

// Ideas (§8 F22 "Ideas").

export type FypIdeaRow = typeof fypIdeas.$inferSelect;

export async function insertFypIdea(
  idea: { universityId: string; authorUserId: string; title: string; description: string; keyphrases: string[]; supervisorIdea: boolean },
  db: DbOrTx = getDb(),
): Promise<string> {
  const [row] = await db.insert(fypIdeas).values(idea).returning({ id: fypIdeas.id });
  if (!row) throw new Error('idea insert returned no row');
  return row.id;
}

export async function getFypIdea(ideaId: string, db: DbOrTx = getDb()): Promise<FypIdeaRow | null> {
  const [row] = await db.select().from(fypIdeas).where(eq(fypIdeas.id, ideaId));
  return row ?? null;
}

export async function lockFypIdea(ideaId: string, tx: Tx): Promise<FypIdeaRow | null> {
  const [row] = await tx.select().from(fypIdeas).where(eq(fypIdeas.id, ideaId)).for('update');
  return row ?? null;
}

export async function setFypIdeaStatus(ideaId: string, status: FypIdeaRow['status'], threadId: string | null | undefined, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(fypIdeas)
    .set(threadId === undefined ? { status } : { status, threadId })
    .where(eq(fypIdeas.id, ideaId));
}

export type IdeaListItem = {
  id: string;
  title: string;
  description: string;
  keyphrases: string[];
  supervisorIdea: boolean;
  status: FypIdeaRow['status'];
  authorLogin: string | null;
  interested: number;
  createdAt: Date;
};

/**
 * Ideas at a university, newest first (§8 F22 "UI": filter by tag, status, supervisor ideas): only
 * from active members, never across a block with the viewer; archived ideas only when asked for.
 */
export async function ideasAt(
  universityId: string,
  viewerId: string,
  filter: { tag: string | null; status: FypIdeaRow['status'] | null; supervisorOnly: boolean },
  limit: number,
  db: DbOrTx = getDb(),
): Promise<IdeaListItem[]> {
  const tag = filter.tag === null ? sql`` : sql`and exists (select 1 from unnest(i.keyphrases) k where lower(k) = lower(${filter.tag}))`;
  const status = filter.status === null ? sql`and i.status <> 'archived'` : sql`and i.status = ${filter.status}`;
  const supervisor = filter.supervisorOnly ? sql`and i.supervisor_idea` : sql``;
  const rows = await db.execute<{
    id: string;
    title: string;
    description: string;
    keyphrases: string[];
    supervisor_idea: boolean;
    status: FypIdeaRow['status'];
    login: string | null;
    interested: string;
    created_at: string;
  }>(sql`
    select i.id, i.title, i.description, i.keyphrases, i.supervisor_idea, i.status, gi.login, i.created_at,
           (select count(*) from fyp_interest f where f.idea_id = i.id) as interested
    from fyp_ideas i
    join users u on u.id = i.author_user_id
    left join github_identities gi on gi.user_id = i.author_user_id
    where i.university_id = ${universityId} and u.status = 'active'
      and not exists (select 1 from blocks b where (b.blocker = ${viewerId} and b.blocked = i.author_user_id) or (b.blocker = i.author_user_id and b.blocked = ${viewerId}))
      ${tag} ${status} ${supervisor}
    order by i.created_at desc, i.id
    limit ${limit}`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    keyphrases: row.keyphrases,
    supervisorIdea: row.supervisor_idea,
    status: row.status,
    authorLogin: row.login,
    interested: Number(row.interested),
    createdAt: new Date(row.created_at),
  }));
}

export async function upsertFypInterest(ideaId: string, userId: string, message: string, db: DbOrTx = getDb()): Promise<void> {
  await db
    .insert(fypInterest)
    .values({ ideaId, userId, message })
    .onConflictDoUpdate({ target: [fypInterest.ideaId, fypInterest.userId], set: { message } });
}

export async function deleteFypInterest(ideaId: string, userId: string, db: DbOrTx = getDb()): Promise<void> {
  await db.delete(fypInterest).where(and(eq(fypInterest.ideaId, ideaId), eq(fypInterest.userId, userId)));
}

export type InterestView = { userId: string; login: string | null; message: string; createdAt: Date };

/** Members interested in an idea, earliest first; only active accounts. */
export async function interestIn(ideaId: string, db: DbOrTx = getDb()): Promise<InterestView[]> {
  const rows = await db.execute<{ user_id: string; login: string | null; message: string; created_at: string }>(sql`
    select f.user_id, gi.login, f.message, f.created_at from fyp_interest f
    join users u on u.id = f.user_id
    left join github_identities gi on gi.user_id = f.user_id
    where f.idea_id = ${ideaId} and u.status = 'active'
    order by f.created_at, f.user_id`);
  return rows.map((row) => ({ userId: row.user_id, login: row.login, message: row.message, createdAt: new Date(row.created_at) }));
}
