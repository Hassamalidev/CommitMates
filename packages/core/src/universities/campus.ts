import {
  campusCounts,
  campusTopics,
  getOrCreateInvite,
  getSetting,
  getUniversityBySlug,
  listRecentNotifications,
  recordInviteUse,
  type NotificationRow,
  type SettingKey,
  type TopicCount,
  type UniversitySummary,
} from '@commitmates/db';

import type { Member } from '../profiles/schemas';

/** Topics shown on a university page. */
const TOP_TOPICS = 12;
/** Notifications shown on the member home. */
const RECENT_NOTIFICATIONS = 5;

export type UnlockKey = 'matching' | 'reviews' | 'swap' | 'gapCampus' | 'leaderboard' | 'fypBoard' | 'alumni' | 'legacy';
type UnlockMetric = 'members' | 'alumni' | 'legacyProjects';

/**
 * Campus features and what unlocks each at one university (CLAUDE.md §1.4, §1.5). The required
 * numbers are settings, never code. Squads unlock per event, not per university, so they are not here.
 */
const UNLOCKS: readonly { key: UnlockKey; setting: SettingKey; metric: UnlockMetric }[] = [
  { key: 'matching', setting: 'unlock.matching.minMembers', metric: 'members' },
  { key: 'reviews', setting: 'unlock.reviews.minMembers', metric: 'members' },
  { key: 'swap', setting: 'unlock.swap.minMembers', metric: 'members' },
  { key: 'gapCampus', setting: 'unlock.gapCampus.minMembers', metric: 'members' },
  { key: 'leaderboard', setting: 'unlock.leaderboard.minMembers', metric: 'members' },
  { key: 'fypBoard', setting: 'unlock.fypBoard.minMembers', metric: 'members' },
  { key: 'alumni', setting: 'unlock.alumni.minAlumni', metric: 'alumni' },
  { key: 'legacy', setting: 'unlock.legacy.minProjects', metric: 'legacyProjects' },
];

export type Unlock = { key: UnlockKey; metric: UnlockMetric; current: number; required: number; unlocked: boolean };

export type Campus = { university: UniversitySummary; members: number; alumni: number; unlocks: Unlock[]; topics: TopicCount[] };

/** Progress of every campus feature at a university, with thresholds read from settings. */
export async function campusUnlocks(universityId: string): Promise<{ members: number; alumni: number; unlocks: Unlock[] }> {
  const counts = await campusCounts(universityId);
  // Senior's Legacy entries arrive with F17 (P5-T09); until then a university has none.
  const metrics: Record<UnlockMetric, number> = { members: counts.members, alumni: counts.alumni, legacyProjects: 0 };
  const required = await Promise.all(UNLOCKS.map((unlock) => getSetting(unlock.setting)));
  const unlocks = UNLOCKS.map((unlock, index) => {
    const threshold = Number(required[index]);
    const current = metrics[unlock.metric];
    return { key: unlock.key, metric: unlock.metric, current, required: threshold, unlocked: current >= threshold };
  });
  return { members: counts.members, alumni: counts.alumni, unlocks };
}

/** Everything the university page shows (CLAUDE.md §9.6): counts, unlocks and members' top topics. */
export async function getCampus(slug: string): Promise<Campus | null> {
  const university = await getUniversityBySlug(slug);
  if (!university) return null;
  const [progress, topics] = await Promise.all([campusUnlocks(university.id), campusTopics(university.id, TOP_TOPICS)]);
  return { university, ...progress, topics };
}

/** The member's invite code for their own university; `null` when they are not verified there. */
export async function inviteFor(member: Pick<Member, 'id' | 'verified' | 'universityId'>, universityId: string): Promise<{ code: string; uses: number } | null> {
  if (!member.verified || member.universityId !== universityId) return null;
  return getOrCreateInvite(universityId, member.id);
}

/**
 * Credits an invite when the invitee is verified at the invite's university (CLAUDE.md §1.4).
 * `ref` is the university slug and `code` the inviter's code, both from the invite link.
 */
export async function creditInvite(member: Pick<Member, 'id' | 'verified' | 'universityId'>, ref: { slug: string; code: string }): Promise<boolean> {
  if (!member.verified || member.universityId === null) return false;
  const university = await getUniversityBySlug(ref.slug);
  if (university?.id !== member.universityId) return false;
  return recordInviteUse(ref.code, university.id, member.id);
}

export function recentNotifications(userId: string): Promise<NotificationRow[]> {
  return listRecentNotifications(userId, RECENT_NOTIFICATIONS);
}
