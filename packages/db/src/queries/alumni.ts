import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type DbOrTx, type Tx } from '../client';
import { alumniQuestions, profiles, questionRoutes } from '../schema';

/** Verified students who graduated before `cutoffYear` (CLAUDE.md §8 F20 "Roles"). */
export async function studentsGraduatedBefore(cutoffYear: number, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(and(eq(profiles.role, 'student'), sql`${profiles.gradYear} < ${cutoffYear}`, sql`${profiles.verifiedAt} is not null`));
  return rows.map((row) => row.userId);
}

export async function markAlumni(userIds: readonly string[], db: DbOrTx = getDb()): Promise<void> {
  if (userIds.length === 0) return;
  await db.update(profiles).set({ role: 'alumni' }).where(and(inArray(profiles.userId, [...userIds]), eq(profiles.role, 'student')));
}

/** Tags of the vocabulary a set of candidate words or phrases name, exactly or as a topic alias (§8 F20 step 1). */
export async function resolveTags(candidates: readonly string[], db: DbOrTx = getDb()): Promise<Map<string, string>> {
  if (candidates.length === 0) return new Map();
  const list = sql`array[${sql.join(candidates.map((candidate) => sql`${candidate}`), sql`, `)}]::text[]`;
  const rows = await db.execute<{ candidate: string; tag: string }>(sql`
    select slug as candidate, slug as tag from topics where slug = any(${list})
    union
    select alias as candidate, t.slug as tag from topics t, unnest(t.aliases) as alias where alias = any(${list})
    union
    select tag as candidate, tag from package_meta, unnest(derived_tags) as tag where derived_tags && ${list} and tag = any(${list})`);
  return new Map(rows.map((row) => [row.candidate, row.tag]));
}

export async function insertAlumniQuestion(
  question: { askerUserId: string; universityId: string; body: string; tags: string[]; anonymous: boolean },
  db: DbOrTx = getDb(),
): Promise<string> {
  const [row] = await db.insert(alumniQuestions).values(question).returning({ id: alumniQuestions.id });
  if (!row) throw new Error('question insert returned no row');
  return row.id;
}

export type AlumniQuestionRow = typeof alumniQuestions.$inferSelect;

export async function getAlumniQuestion(questionId: string, db: DbOrTx = getDb()): Promise<AlumniQuestionRow | null> {
  const [row] = await db.select().from(alumniQuestions).where(eq(alumniQuestions.id, questionId));
  return row ?? null;
}

export async function lockAlumniQuestion(questionId: string, tx: Tx): Promise<AlumniQuestionRow | null> {
  const [row] = await tx.select().from(alumniQuestions).where(eq(alumniQuestions.id, questionId)).for('update');
  return row ?? null;
}

export type AlumnusRow = { userId: string; vector: Record<string, number>; open: number; routed: number; answered: number };

/**
 * Alumni who could take a question (§8 F20 step 2): verified alumni of the university with a skill
 * vector, active, not hidden or in ghost mode, with no block either way with the asker, not already
 * routed this question; with their open load and their routed and answered counts since `since`.
 */
export async function alumniCandidates(universityId: string, askerId: string, questionId: string, since: Date, db: DbOrTx = getDb()): Promise<AlumnusRow[]> {
  const rows = await db.execute<{ user_id: string; vector: Record<string, number>; open: string; routed: string; answered: string }>(sql`
    select p.user_id, v.vector,
           (select count(*) from question_routes r where r.alumni_user_id = p.user_id and r.status = 'pending') as open,
           (select count(*) from question_routes r where r.alumni_user_id = p.user_id and r.routed_at >= ${since.toISOString()}::timestamptz) as routed,
           (select count(*) from question_routes r where r.alumni_user_id = p.user_id and r.status = 'answered' and r.routed_at >= ${since.toISOString()}::timestamptz) as answered
    from profiles p
    join users u on u.id = p.user_id
    join skill_vectors v on v.user_id = p.user_id
    where p.university_id = ${universityId} and p.role = 'alumni' and p.verified_at is not null and u.status = 'active'
      and not p.ghost_mode and p.visibility <> 'hidden' and p.user_id <> ${askerId}
      and not exists (select 1 from question_routes r where r.question_id = ${questionId} and r.alumni_user_id = p.user_id)
      and not exists (select 1 from blocks b where (b.blocker = ${askerId} and b.blocked = p.user_id) or (b.blocker = p.user_id and b.blocked = ${askerId}))
    order by p.user_id`);
  return rows.map((row) => ({ userId: row.user_id, vector: row.vector, open: Number(row.open), routed: Number(row.routed), answered: Number(row.answered) }));
}

/** Routes a question to alumni in a round and moves the question to that round. */
export async function routeAlumniQuestion(questionId: string, round: number, alumniIds: readonly string[], now: Date, tx: Tx): Promise<void> {
  await tx.update(alumniQuestions).set({ round }).where(eq(alumniQuestions.id, questionId));
  if (alumniIds.length === 0) return;
  await tx
    .insert(questionRoutes)
    .values(alumniIds.map((alumniUserId) => ({ questionId, alumniUserId, round, routedAt: now })))
    .onConflictDoNothing();
}

export async function setAlumniQuestionStatus(questionId: string, status: AlumniQuestionRow['status'], db: DbOrTx = getDb()): Promise<void> {
  await db.update(alumniQuestions).set({ status }).where(eq(alumniQuestions.id, questionId));
}

/** Pending routes older than `before` become expired; the questions they belonged to. */
export async function expireStaleRoutes(before: Date, db: DbOrTx = getDb()): Promise<string[]> {
  const rows = await db.execute<{ question_id: string }>(sql`
    update question_routes set status = 'expired'
    where status = 'pending' and routed_at < ${before.toISOString()}::timestamptz
    returning question_id`);
  return [...new Set(rows.map((row) => row.question_id))];
}

/** Open questions whose current round has no pending route left. */
export async function questionsAwaitingReroute(questionIds: readonly string[] | null, db: DbOrTx = getDb()): Promise<{ id: string; round: number }[]> {
  const scope = questionIds === null ? sql`` : questionIds.length === 0 ? sql`and false` : sql`and q.id in (${sql.join(questionIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const rows = await db.execute<{ id: string; round: number }>(sql`
    select q.id, q.round from alumni_questions q
    where q.status = 'open' ${scope}
      and not exists (select 1 from question_routes r where r.question_id = q.id and r.round = q.round and r.status = 'pending')`);
  return rows.map((row) => ({ id: row.id, round: row.round }));
}

/** The route an alumnus holds on a question, locked for an answer or a pass. */
export async function lockQuestionRoute(questionId: string, alumniUserId: string, tx: Tx) {
  const [row] = await tx
    .select()
    .from(questionRoutes)
    .where(and(eq(questionRoutes.questionId, questionId), eq(questionRoutes.alumniUserId, alumniUserId)))
    .for('update');
  return row ?? null;
}

export async function setRouteStatus(questionId: string, alumniUserId: string, status: 'answered' | 'passed', now: Date, tx: DbOrTx): Promise<void> {
  await tx
    .update(questionRoutes)
    .set({ status, respondedAt: now })
    .where(and(eq(questionRoutes.questionId, questionId), eq(questionRoutes.alumniUserId, alumniUserId)));
}

/** Records the answer: the question is answered by this alumnus in this thread; other pending routes end. */
export async function markQuestionAnswered(questionId: string, alumniUserId: string, threadId: string, now: Date, tx: Tx): Promise<void> {
  await tx.update(alumniQuestions).set({ status: 'answered', answeredBy: alumniUserId, threadId, answeredAt: now }).where(eq(alumniQuestions.id, questionId));
  await tx.execute(sql`update question_routes set status = 'passed' where question_id = ${questionId} and status = 'pending' and alumni_user_id <> ${alumniUserId}`);
}

export type AskedQuestion = AlumniQuestionRow & { answeredByLogin: string | null };

/** A member's own questions, newest first. */
export async function questionsAskedBy(userId: string, limit: number, db: DbOrTx = getDb()): Promise<AskedQuestion[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from alumni_questions where asker_user_id = ${userId} order by created_at desc limit ${limit}`);
  if (rows.length === 0) return [];
  const questions = await db.select().from(alumniQuestions).where(inArray(alumniQuestions.id, rows.map((row) => row.id)));
  const logins = await db.execute<{ user_id: string; login: string }>(sql`
    select user_id, login from github_identities where user_id in (select answered_by from alumni_questions where asker_user_id = ${userId} and answered_by is not null)`);
  const byUser = new Map(logins.map((row) => [row.user_id, row.login]));
  return questions
    .map((question) => ({ ...question, answeredByLogin: question.answeredBy ? (byUser.get(question.answeredBy) ?? null) : null }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export type RoutedQuestion = { questionId: string; body: string; tags: string[]; anonymous: boolean; askerLogin: string | null; status: string; routeStatus: string; round: number; routedAt: Date };

/** Questions routed to an alumnus, newest first; an anonymous asker's login only once this alumnus answered. */
export async function questionsRoutedTo(alumniUserId: string, limit: number, db: DbOrTx = getDb()): Promise<RoutedQuestion[]> {
  const rows = await db.execute<{
    question_id: string;
    body: string;
    tags: string[];
    anonymous: boolean;
    asker_login: string | null;
    status: string;
    route_status: string;
    round: number;
    routed_at: string;
  }>(sql`
    select r.question_id, q.body, q.tags, q.anonymous, case when q.anonymous and r.status <> 'answered' then null else gi.login end as asker_login,
           q.status, r.status as route_status, r.round, r.routed_at
    from question_routes r join alumni_questions q on q.id = r.question_id
    left join github_identities gi on gi.user_id = q.asker_user_id
    where r.alumni_user_id = ${alumniUserId}
    order by r.routed_at desc limit ${limit}`);
  return rows.map((row) => ({
    questionId: row.question_id,
    body: row.body,
    tags: row.tags,
    anonymous: row.anonymous,
    askerLogin: row.asker_login,
    status: row.status,
    routeStatus: row.route_status,
    round: row.round,
    routedAt: new Date(row.routed_at),
  }));
}

/** Sets a member's graduation year and role together (the alumni page's correction after the transition). */
export async function setGraduation(userId: string, gradYear: number, role: 'student' | 'alumni', db: DbOrTx = getDb()): Promise<void> {
  await db.update(profiles).set({ gradYear, role }).where(eq(profiles.userId, userId));
}
