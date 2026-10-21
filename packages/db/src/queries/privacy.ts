import { eq, inArray, or, sql } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { hashUserId } from '../logger';
import {
  adoptions,
  analysisCache,
  blocks,
  connections,
  creditLedger,
  emailVerifications,
  feedback,
  ghRepos,
  ghUsers,
  githubIdentities,
  graveyardListings,
  invites,
  ledgerLocks,
  legacyEntries,
  listingSuggestions,
  matchSuggestions,
  messageRequests,
  messages,
  notificationPrefs,
  notifications,
  ossMemberContribs,
  pairCompanions,
  pairDays,
  pairInvites,
  pairs,
  personaSnapshots,
  profiles,
  recruiterReports,
  reports,
  repoDependencies,
  reviewRequests,
  reviews,
  repoManifests,
  roles,
  skillVectors,
  swapOffers,
  swapProposals,
  swapResponses,
  swapWants,
  threadMembers,
  threads,
  trustScores,
  universityRequests,
  users,
  vouches,
} from '../schema';

import { writeAudit } from './admin';
import { insertNotification } from './chat';
import { openPairPartners } from './streaks';

/** System message body left in shared threads when a member deletes their account; the page renders it from copy. */
export const MEMBER_LEFT_NOTE = 'member_left';

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
    recruiterRows,
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

  // Social and streak rows (CLAUDE.md §7.6, §7.7): what the member wrote, sent, joined or keeps.
  const ownPairs = await db.select().from(pairs).where(or(eq(pairs.userA, userId), eq(pairs.userB, userId)));
  const pairIds = ownPairs.map((pair) => pair.id);
  const [suggestions, connectionRows, requestRows, memberships, messageRows, blockRows, reportRows, trust, vectors, snapshots, days, companions] = await Promise.all([
    db.select().from(matchSuggestions).where(eq(matchSuggestions.userId, userId)),
    db.select().from(connections).where(or(eq(connections.userA, userId), eq(connections.userB, userId))),
    db.select().from(messageRequests).where(or(eq(messageRequests.fromUser, userId), eq(messageRequests.toUser, userId))),
    db.select().from(threadMembers).where(eq(threadMembers.userId, userId)),
    db.select().from(messages).where(eq(messages.authorUserId, userId)),
    db.select().from(blocks).where(eq(blocks.blocker, userId)),
    db.select().from(reports).where(eq(reports.reporter, userId)),
    db.select().from(trustScores).where(eq(trustScores.userId, userId)),
    db.select().from(skillVectors).where(eq(skillVectors.userId, userId)),
    db.select().from(personaSnapshots).where(eq(personaSnapshots.userId, userId)),
    pairIds.length === 0 ? Promise.resolve([]) : db.select().from(pairDays).where(inArray(pairDays.pairId, pairIds)),
    pairIds.length === 0 ? Promise.resolve([]) : db.select().from(pairCompanions).where(inArray(pairCompanions.pairId, pairIds)),
  ]);

  // Collaboration rows (CLAUDE.md §7.8): listings, adoptions, reviews, credits, swaps, showcase, contributions.
  const [listingRows, suggestionRows, adoptionRows, requestRowsF15, reviewRows, ledgerRows, lockRows, offerRows, wantRows, proposalRows, responseRows, legacyRows, contribRows] =
    await Promise.all([
      db.select().from(graveyardListings).where(eq(graveyardListings.ownerUserId, userId)),
      db.select().from(listingSuggestions).where(eq(listingSuggestions.ownerUserId, userId)),
      db.select().from(adoptions).where(eq(adoptions.adopterUserId, userId)),
      db.select().from(reviewRequests).where(or(eq(reviewRequests.authorUserId, userId), eq(reviewRequests.claimedBy, userId))),
      db.select().from(reviews).where(eq(reviews.reviewerUserId, userId)),
      db.select().from(creditLedger).where(eq(creditLedger.userId, userId)),
      db.select().from(ledgerLocks).where(eq(ledgerLocks.userId, userId)),
      db.select().from(swapOffers).where(eq(swapOffers.userId, userId)),
      db.select().from(swapWants).where(eq(swapWants.userId, userId)),
      db.select().from(swapProposals).where(sql`${swapProposals.members} @> array[${userId}]::uuid[]`),
      db.select().from(swapResponses).where(eq(swapResponses.userId, userId)),
      db.select().from(legacyEntries).where(eq(legacyEntries.ownerUserId, userId)),
      db.select().from(ossMemberContribs).where(eq(ossMemberContribs.userId, userId)),
    ]);
  const pairInviteRows = await db.select().from(pairInvites).where(or(eq(pairInvites.fromUser, userId), eq(pairInvites.toUser, userId)));
  const threadIds = memberships.map((membership) => membership.threadId);
  const threadRows = threadIds.length === 0 ? [] : await db.select().from(threads).where(inArray(threads.id, threadIds));

  return {
    match_suggestions: suggestions,
    threads: threadRows,
    connections: connectionRows,
    message_requests: requestRows,
    thread_members: memberships,
    messages: messageRows,
    blocks: blockRows,
    reports: reportRows,
    trust_scores: trust,
    skill_vectors: vectors,
    persona_snapshots: snapshots,
    pairs: ownPairs,
    pair_days: days,
    pair_companions: companions,
    pair_invites: pairInviteRows,
    graveyard_listings: listingRows,
    listing_suggestions: suggestionRows,
    adoptions: adoptionRows,
    review_requests: requestRowsF15,
    reviews: reviewRows,
    credit_ledger: ledgerRows,
    ledger_locks: lockRows,
    swap_offers: offerRows,
    swap_wants: wantRows,
    swap_proposals: proposalRows,
    swap_responses: responseRows,
    legacy_entries: legacyRows,
    oss_member_contribs: contribRows,
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
    recruiter_reports: recruiterRows,
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
 * audit entry that holds only a hash of the user id (§5.12 steps 2 and 5). The member's messages in
 * threads shared with others become one system note per thread. Deleting the auth user
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
    // Swap proposals name their members in an array, not by foreign key, so they go explicitly.
    await tx.delete(swapProposals).where(sql`${swapProposals.members} @> array[${userId}]::uuid[]`);
    // Pairs end with the account (rows cascade); the partner is told (§8 F13 "Edge cases").
    for (const partner of await openPairPartners(userId, tx)) await insertNotification(partner, 'pair_ended', {}, tx);
    // Threads shared with others keep going: the member's messages are replaced by one system note
    // (§5.12 step 2). Threads only they were in are deleted with their messages.
    await tx.execute(sql`
      with mine as (select thread_id from thread_members where user_id = ${userId}),
           shared as (select distinct tm.thread_id from thread_members tm join mine using (thread_id) where tm.user_id <> ${userId}),
           removed as (delete from messages where author_user_id = ${userId} and thread_id in (select thread_id from shared) returning 1),
           solo as (delete from threads where id in (select thread_id from mine except select thread_id from shared) returning 1)
      insert into messages (thread_id, author_user_id, kind, body)
      select thread_id, null, 'system', ${MEMBER_LEFT_NOTE} from shared`);
    await writeAudit(
      { actorUserId: null, action: 'account.deleted', targetType: 'user', targetId: hashUserId(userId), data: { at: now.toISOString() } },
      tx,
    );
  });
}
