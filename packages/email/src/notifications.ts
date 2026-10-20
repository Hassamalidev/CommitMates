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
  pair_paused: (data) => ({
    title: 'Your streak is paused',
    line: text(data.login)
      ? `Your shared streak with @${text(data.login)} is paused after a few missed days. Check in with them, or start one with someone new.`
      : 'Your shared streak is paused after a few missed days. Check in with your partner, or start one with someone new.',
    path: '/streaks',
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
  pair_paused: 'Paused streaks',
};
