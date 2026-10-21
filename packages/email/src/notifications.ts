/**
 * Words for in-app notifications, shared by the notification center and the daily digest email
 * (CLAUDE.md §7.5, §9.8). Each kind's data is stored as JSON; anything missing reads as empty.
 */

export type NotificationText = {
  /** A short heading, e.g. "New message request". */
  title: string;
  /** One sentence about what happened. */
  line: string;
  /** Where the member can act on it, relative to the site. */
  path: string;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const describers: Readonly<Record<string, (data: Record<string, unknown>) => NotificationText>> = {
  university_request_approved: (data) => ({
    title: 'University request approved',
    line: `Your request for ${text(data.domain)} was approved${text(data.universityName) ? ` as ${text(data.universityName)}` : ''}.`,
    path: '/onboarding',
  }),
  university_request_rejected: (data) => ({
    title: 'University request not approved',
    line: `Your request for ${text(data.domain)} was not approved.`,
    path: '/onboarding',
  }),
  verified_by_vouches: () => ({
    title: 'You are verified',
    line: 'Members of your university vouched for you. You are verified.',
    path: '/home',
  }),
  chat_request: (data) => ({
    title: 'New message request',
    line: text(data.login) ? `@${text(data.login)} sent you a message request.` : 'You have a new message request.',
    path: '/inbox',
  }),
  chat_request_accepted: (data) => ({
    title: 'Request accepted',
    line: text(data.login) ? `@${text(data.login)} accepted your message request.` : 'Your message request was accepted.',
    // Only a thread id ever goes into the link.
    path: isUuid(text(data.threadId)) ? `/inbox/${text(data.threadId)}` : '/inbox',
  }),
  pair_invite: (data) => ({
    title: 'Streak invitation',
    line: text(data.login) ? `@${text(data.login)} invited you to keep a shared coding streak.` : 'You were invited to keep a shared coding streak.',
    path: '/streaks',
  }),
  pair_accepted: (data) => ({
    title: 'Streak started',
    line: text(data.login) ? `@${text(data.login)} accepted. Your shared streak starts today.` : 'Your shared streak starts today.',
    path: '/streaks',
  }),
  pair_ended: (data) => ({
    title: 'A shared streak ended',
    line: text(data.login) ? `Your shared streak with @${text(data.login)} has ended.` : 'One of your shared streaks has ended because your partner left.',
    path: '/streaks',
  }),
  pair_paused: (data) => ({
    title: 'Your streak is paused',
    line: text(data.login)
      ? `Your shared streak with @${text(data.login)} is paused after a few missed days. Check in with them, or start one with someone new.`
      : 'Your shared streak is paused after a few missed days. Check in with your partner, or start one with someone new.',
    path: '/streaks',
  }),
  adoption_revived: (data) => ({
    title: 'A project was revived',
    line:
      text(data.role) === 'owner'
        ? `${text(data.repo) || 'Your project'} is being worked on again in ${text(data.fork) || 'its new fork'}. You both earned the Revived badge.`
        : `Your work brought ${text(data.repo) || 'the project you adopted'} back to life. You earned the Revived badge.`,
    path: '/settings/projects',
  }),
  adoption_dropped: (data) => ({
    title: 'An adoption ended',
    line:
      text(data.role) === 'owner'
        ? `The adoption of ${text(data.repo) || 'your project'} ended without new commits. You can put it up for adoption again.`
        : `Your adoption of ${text(data.repo) || 'a project'} ended because its fork had no new commits for a while.`,
    path: '/settings/projects',
  }),
  review_claimed: (data) => ({
    title: 'Your pull request was claimed',
    line: `${text(data.login) ? `@${text(data.login)}` : 'A classmate'} will review ${text(data.repo) ? `${text(data.repo)}#${text(data.number)}` : 'your pull request'}.`,
    path: '/reviews',
  }),
  review_refunded: (data) => ({
    title: 'Review request ended',
    line:
      text(data.reason) === 'expired'
        ? 'Nobody reviewed your pull request in time, so the request ended and your credit is back.'
        : 'Your pull request was closed or is no longer public, so the request ended and your credit is back.',
    path: '/reviews',
  }),
  github_reconnect: () => ({
    title: 'Sign in with GitHub again',
    line: 'Your GitHub sign-in has expired, so a streak day was skipped instead of counted. Sign in again to keep it going.',
    path: '/auth/sign-in?next=/streaks',
  }),
  account_hidden: () => ({
    title: 'Your account is hidden for now',
    line: 'Your account is hidden from others while moderators review reports about it. You can tell them your side.',
    path: '/feedback?about=appeal',
  }),
  account_restored: () => ({
    title: 'Your account is visible again',
    line: 'Moderators reviewed the reports about your account. It is visible again.',
    path: '/home',
  }),
  moderation_warning: (data) => ({
    title: 'A warning from a moderator',
    line: text(data.note) ? `A moderator sent you a warning: ${text(data.note)}` : 'A moderator sent you a warning about how you use the site.',
    path: '/home',
  }),
};

/** The words for a notification, or null for a kind this version does not know. */
export function describeNotification(kind: string, data: unknown): NotificationText | null {
  const describe = describers[kind];
  if (!describe) return null;
  return describe(typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {});
}

/**
 * Kinds a member may mute (CLAUDE.md §7.5 `notification_prefs.kinds_muted`), with their label in the
 * settings. Notices about the account itself and moderation are never muted.
 */
export const MUTABLE_NOTIFICATIONS: Readonly<Record<string, string>> = {
  chat_request: 'New message requests',
  chat_request_accepted: 'Accepted message requests',
  pair_invite: 'Streak invitations',
  pair_accepted: 'Accepted streak invitations',
  pair_ended: 'Ended streaks',
  pair_paused: 'Paused streaks',
  adoption_revived: 'Revived projects',
  adoption_dropped: 'Ended adoptions',
  review_claimed: 'Claimed review requests',
  review_refunded: 'Ended review requests',
};
