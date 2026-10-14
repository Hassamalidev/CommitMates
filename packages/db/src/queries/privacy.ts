import { eq, inArray, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { hashUserId } from '../logger';
import {
  analysisCache,
  emailVerifications,
  feedback,
  ghRepos,
  ghUsers,
  githubIdentities,
  invites,
  notificationPrefs,
  notifications,
  profiles,
  recruiterReports,
  repoDependencies,
  repoManifests,
  roles,
  universityRequests,
  users,
  vouches,
} from '../schema';

import { writeAudit } from './admin';

/** Cache keys that are about a member: their login, `login:<login>`, or a sorted pair containing it. */
const memberCacheKeys = (login: string) => {
  const key = login.toLowerCase();
  return or(
    eq(analysisCache.subjectKey, key),
    sql`${analysisCache.subjectKey} like ${`${key}:%`}`,
    sql`${analysisCache.subjectKey} like ${`%:${key}`}`,
  );
};

/**
 * Every class A and B row about a member (CLAUDE.md §5.12 "Export"), grouped by table. Secrets
 * are left out: the encrypted GitHub token and a verification code's hash.
 */
export async function exportMemberRows(userId: string, db: DbOrTx = getDb()): Promise<Record<string, unknown[]>> {
  const [identity] = await db
    .select({ githubId: githubIdentities.githubId, login: githubIdentities.login })
    .from(githubIdentities)
    .where(eq(githubIdentities.userId, userId));
  const githubId = identity?.githubId ?? null;
  const login = identity?.login ?? null;
  const ownRepos = githubId === null ? [] : await db.select().from(ghRepos).where(eq(ghRepos.ownerGithubId, githubId));
  const repoIds = ownRepos.map((repo) => repo.githubId);
  const inRepos = <T>(query: (ids: number[]) => Promise<T[]>) => (repoIds.length === 0 ? Promise.resolve([]) : query(repoIds));

  const [
    user,
    identityRows,
    profile,
    roleRows,
    verifications,
    requests,
    vouchRows,
    inviteRows,
    notificationRows,
    prefs,
    feedbackRows,
    ghUserRows,
    manifests,
    dependencies,
    cached,
    reports,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    db
      .select({
        githubId: githubIdentities.githubId,
        login: githubIdentities.login,
        name: githubIdentities.name,
        avatarUrl: githubIdentities.avatarUrl,
        scopes: githubIdentities.scopes,
        tokenInvalid: githubIdentities.tokenInvalid,
        privateContribVisible: githubIdentities.privateContribVisible,
        createdAt: githubIdentities.createdAt,
      })
      .from(githubIdentities)
      .where(eq(githubIdentities.userId, userId)),
    db.select().from(profiles).where(eq(profiles.userId, userId)),
    db.select().from(roles).where(eq(roles.userId, userId)),
    db
      .select({
        id: emailVerifications.id,
        email: emailVerifications.email,
        domain: emailVerifications.domain,
        universityId: emailVerifications.universityId,
        expiresAt: emailVerifications.expiresAt,
        attempts: emailVerifications.attempts,
        sendsToday: emailVerifications.sendsToday,
        lastSentAt: emailVerifications.lastSentAt,
        verifiedAt: emailVerifications.verifiedAt,
        createdAt: emailVerifications.createdAt,
      })
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, userId)),
    db.select().from(universityRequests).where(eq(universityRequests.userId, userId)),
    db.select().from(vouches).where(or(eq(vouches.voucherUserId, userId), eq(vouches.voucheeUserId, userId))),
    db.select().from(invites).where(eq(invites.createdBy, userId)),
    db.select().from(notifications).where(eq(notifications.userId, userId)),
    db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)),
    db.select().from(feedback).where(eq(feedback.userId, userId)),
    githubId === null ? Promise.resolve([]) : db.select().from(ghUsers).where(eq(ghUsers.githubId, githubId)),
    inRepos((ids) => db.select().from(repoManifests).where(inArray(repoManifests.repoGithubId, ids))),
    inRepos((ids) => db.select().from(repoDependencies).where(inArray(repoDependencies.repoGithubId, ids))),
    login === null ? Promise.resolve([]) : db.select().from(analysisCache).where(memberCacheKeys(login)),
    db.select().from(recruiterReports).where(eq(recruiterReports.userId, userId)),
  ]);

  return {
    users: user,
    github_identities: identityRows,
    profiles: profile,
    roles: roleRows,
    email_verifications: verifications,
    university_requests: requests,
    vouches: vouchRows,
    invites: inviteRows,
    notifications: notificationRows,
    notification_prefs: prefs,
    feedback: feedbackRows,
    gh_users: ghUserRows,
    gh_repos: ownRepos,
    repo_manifests: manifests,
    repo_dependencies: dependencies,
    analysis_cache: cached,
    recruiter_reports: reports,
  };
}

/** Updates the privacy choices on the member's profile (§5.12, §2.6). */
export async function updatePrivacy(
  userId: string,
  choices: { visibility: 'university' | 'country' | 'public' | 'hidden'; ghostMode: boolean },
  db: DbOrTx = getDb(),
): Promise<void> {
  await db.update(profiles).set(choices).where(eq(profiles.userId, userId));
}

/**
 * Deletes what a member's account owns but no foreign key can cascade from: analyses cached about
 * them (by login) and their GitHub user and repository rows (by GitHub id), in one transaction with an
 * audit entry that holds only a hash of the user id (§5.12 steps 2 and 5). Deleting the auth user
 * afterwards removes everything else through `on delete cascade`.
 */
export async function deleteMemberData(userId: string, now: Date, db: DbOrTx = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const [identity] = await tx
      .select({ githubId: githubIdentities.githubId, login: githubIdentities.login })
      .from(githubIdentities)
      .where(eq(githubIdentities.userId, userId));
    if (identity) {
      await tx.delete(analysisCache).where(memberCacheKeys(identity.login));
      // Manifests, dependencies and paths of these repositories go with them (cascade).
      await tx.delete(ghRepos).where(eq(ghRepos.ownerGithubId, identity.githubId));
      await tx.delete(ghUsers).where(eq(ghUsers.githubId, identity.githubId));
    }
    await writeAudit(
      { actorUserId: null, action: 'account.deleted', targetType: 'user', targetId: hashUserId(userId), data: { at: now.toISOString() } },
      tx,
    );
  });
}
