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
  review_submitted: (data) => ({
    title: 'Your review is in',
    line: `${text(data.login) ? `@${text(data.login)}` : 'Your reviewer'} reviewed ${text(data.repo) ? `${text(data.repo)}#${text(data.number)}` : 'your pull request'}. Was it helpful?`,
    path: '/reviews',
  }),
  review_rated: (data) => ({
    title: text(data.rating) === 'helpful' ? 'You earned a credit' : 'Your review was rated',
    line:
      text(data.rating) === 'helpful'
        ? data.automatic === true
          ? 'Your review settled as helpful, so the credit is yours.'
          : 'The author found your review helpful, so the credit is yours.'
        : 'The author did not find your review helpful. You can dispute the rating if you disagree.',
    path: '/reviews',
  }),
  review_claim_expired: (data) => ({
    title: 'Your claim ran out',
    line: `Your claim on ${text(data.repo) ? `${text(data.repo)}#${text(data.number)}` : 'a review request'} ran out before a review showed up on GitHub, so it is open again.`,
    path: '/reviews',
  }),
  review_dispute_resolved: (data) => ({
    title: 'A review dispute was decided',
    line:
      text(data.outcome) === 'reviewer'
        ? text(data.role) === 'reviewer'
          ? 'A moderator agreed your review was helpful. The credit is yours.'
          : 'A moderator found the review helpful. Your refund stands.'
        : text(data.role) === 'reviewer'
          ? 'A moderator kept the unhelpful rating.'
          : 'A moderator kept your unhelpful rating.',
    path: '/reviews',
  }),
  swap_proposed: (data) => ({
    title: 'A skill swap for you',
    line: data.size === 3 ? 'Two classmates and you could each teach the next one something. Take a look.' : 'A classmate could teach you something you want to learn, and you them. Take a look.',
    path: '/swaps',
  }),
  swap_declined: () => ({
    title: 'A skill swap did not happen',
    line: 'Someone passed on a skill swap you were part of. We will look for another one tomorrow.',
    path: '/swaps',
  }),
  swap_accepted: (data) => ({
    title: 'Your skill swap is on',
    line: 'Everyone accepted. Say hello in your group conversation.',
    path: isUuid(text(data.threadId)) ? `/inbox/${text(data.threadId)}` : '/inbox',
  }),
  became_alumni: () => ({
    title: 'Welcome to the alumni',
    line: 'Your graduation year has passed, so you are now listed as an alumnus. If that is wrong, correct your graduation year on the Alumni page.',
    path: '/alumni',
  }),
  alumni_question: () => ({
    title: 'A student has a question for you',
    line: 'A student at your university asked something you know about. A short answer goes a long way.',
    path: '/alumni',
  }),
  alumni_answered: (data) => ({
    title: 'Your question was answered',
    line: text(data.login) ? `@${text(data.login)} answered your question. Continue in your conversation.` : 'An alumnus answered your question. Continue in your conversation.',
    path: isUuid(text(data.threadId)) ? `/inbox/${text(data.threadId)}` : '/alumni',
  }),
  alumni_expired: () => ({
    title: 'Your question got no answer',
    line: 'No alumnus picked up your question this time. Try posting it on the FYP Board, or ask a classmate directly.',
    path: '/alumni',
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
  review_submitted: 'Reviews to rate',
  review_rated: 'Ratings of your reviews',
  review_claim_expired: 'Claims that ran out',
  swap_proposed: 'Skill swap proposals',
  swap_declined: 'Skill swaps that did not happen',
  swap_accepted: 'Skill swaps everyone accepted',
  alumni_question: 'Questions for you as an alumnus',
  alumni_answered: 'Answers to your questions',
  alumni_expired: 'Questions that got no answer',
};
