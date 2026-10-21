import { getSetting, memberBadgeCounts, memberLegacyEntries, revivedProjectsOf, type LegacyEntryView, type RevivedProject } from '@commitmates/db';

import { reviewReputation, type ReviewReputation } from '../reviews/settlement';

export type MemberBadges = {
  /** Helpful reviews on the Review Exchange, with their reputation tier (§8 F15). */
  reviewer: ReviewReputation | null;
  /** Projects brought back through an adoption (§8 F14). */
  reviver: RevivedProject[] | null;
  /** A shared streak that reached the first pair-companion stage (§8 F13). */
  streak: { longest: number } | null;
  /** Merged pull requests to other people's projects (§8 F8). */
  oss: { projects: number; mergedPrs: number } | null;
};

/**
 * The badges a member earned (CLAUDE.md §9.5 traits, P5-T10): reviewer, reviver, streak and open
 * source. Each is null until earned. Alumni mentoring (`mentor`) arrives with Alumni Quick Asks.
 */
export async function memberBadges(userId: string, universityId: string | null): Promise<MemberBadges> {
  const [reputation, revived, counts, stageDays] = await Promise.all([
    universityId === null ? Promise.resolve(null) : reviewReputation(userId, universityId),
    revivedProjectsOf(userId),
    memberBadgeCounts(userId),
    getSetting('streaks.companionStageDays'),
  ]);
  const firstStage = stageDays[0] ?? Number.POSITIVE_INFINITY;
  return {
    reviewer: reputation && reputation.helpful > 0 ? reputation : null,
    reviver: revived.length > 0 ? revived : null,
    streak: counts.longestStreak >= firstStage ? { longest: counts.longestStreak } : null,
    oss: counts.ossMergedPrs > 0 ? { projects: counts.ossProjects, mergedPrs: counts.ossMergedPrs } : null,
  };
}

/** The companion traits a member's badges give (§9.5): one per earned badge. */
export function traitsFromBadges(badges: MemberBadges): string[] {
  return [
    ...(badges.reviewer ? ['reviewer'] : []),
    ...(badges.reviver ? ['reviver'] : []),
    ...(badges.streak ? ['streak'] : []),
    ...(badges.oss ? ['oss'] : []),
  ];
}

export type ProfileExtras = { badges: MemberBadges; showcase: LegacyEntryView[] };

/** What a member's profile page shows besides their Dev Card (§8 F1, P5-T10): badges and showcased projects. */
export async function getProfileExtras(owner: { userId: string; universityId: string | null }): Promise<ProfileExtras> {
  const [badges, showcase] = await Promise.all([memberBadges(owner.userId, owner.universityId), memberLegacyEntries(owner.userId)]);
  return { badges, showcase };
}
