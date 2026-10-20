import {
  NotFoundError,
  ValidationError,
  countDistinctReporters,
  declinePendingBetween,
  deleteBlock,
  getChatParticipant,
  getDb,
  getSetting,
  hasBlocked,
  hideForReview,
  insertBlock,
  insertFeedback,
  insertNotification,
  insertReport,
  listBlocked,
  reportableMessageAuthor,
  schema,
  writeAudit,
} from '@commitmates/db';
import { z } from 'zod';

import type { Member } from '../profiles/schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Longest page path stored with feedback. */
const MAX_PAGE_LENGTH = 200;

type Actor = Pick<Member, 'id'>;

const noSuchMember = () => new NotFoundError('safety.member_missing', "We couldn't find that member.");

export const blockSchema = z.object({ userId: z.uuid() });

/**
 * Blocks a member (CLAUDE.md §8 F12): from then on neither can send the other requests or messages,
 * neither appears in the other's Discover, and pending requests between them end silently.
 */
export async function blockMember(member: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const { userId } = blockSchema.parse(raw);
  if (userId === member.id) throw new ValidationError('safety.self', "You can't block yourself.");
  if (!(await getChatParticipant(userId))) throw noSuchMember();
  await getDb().transaction(async (tx) => {
    await insertBlock(member.id, userId, tx);
    await declinePendingBetween(member.id, userId, now, tx);
  });
}

/** Lifts the member's own block. */
export async function unblockMember(member: Actor, raw: unknown): Promise<void> {
  const { userId } = blockSchema.parse(raw);
  if (!(await deleteBlock(member.id, userId))) throw new NotFoundError('safety.not_blocked', "You haven't blocked this member.");
}

/** Whether the member has blocked someone, for the page's Block or Unblock button. */
export function isBlocking(member: Actor, userId: string): Promise<boolean> {
  return hasBlocked(member.id, userId);
}

/** People the member blocked, for the privacy settings. */
export function blockedMembers(member: Actor) {
  return listBlocked(member.id);
}

export const REPORT_REASONS = schema.reportReason.enumValues;

export const reportSchema = z.object({
  targetUserId: z.uuid(),
  messageId: z.uuid().nullable().default(null),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().default(''),
});

/**
 * Reports a member, optionally about one message the reporter can see (CLAUDE.md §8 F12 "Reports and
 * auto-hide"). When `safety.autoHideReports` distinct verified reporters have reported the same member
 * within `safety.reportWindowDays` (dismissed reports and repeats by one reporter do not count), the
 * account is hidden pending review, the action is audited, and the member gets a neutral notice.
 * The reporter is never told whether that happened.
 */
export async function reportMember(member: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  const input = reportSchema.parse(raw);
  if (input.targetUserId === member.id) throw new ValidationError('safety.self', "You can't report yourself.");
  const [target, maxDetails, threshold, windowDays] = await Promise.all([
    getChatParticipant(input.targetUserId),
    getSetting('safety.reportDetailsMaxChars'),
    getSetting('safety.autoHideReports'),
    getSetting('safety.reportWindowDays'),
  ]);
  if (!target) throw noSuchMember();
  if (input.details.length > maxDetails) {
    throw new ValidationError('safety.details_long', `Details can be up to ${maxDetails} characters.`, { field: 'details' });
  }
  if (input.messageId !== null && (await reportableMessageAuthor(input.messageId, member.id)) !== input.targetUserId) {
    throw new NotFoundError('safety.message_missing', 'That message is not one you can report.');
  }

  await getDb().transaction(async (tx) => {
    await insertReport(
      {
        reporter: member.id,
        targetUser: input.targetUserId,
        targetMessage: input.messageId,
        reason: input.reason,
        details: input.details === '' ? null : input.details,
      },
      tx,
    );
    const reporters = await countDistinctReporters(input.targetUserId, new Date(now.getTime() - windowDays * MS_PER_DAY), tx);
    if (reporters >= threshold && (await hideForReview(input.targetUserId, tx))) {
      await writeAudit(
        { actorUserId: null, action: 'safety.auto_hidden', targetType: 'user', targetId: input.targetUserId, data: { reporters, threshold } },
        tx,
      );
      await insertNotification(input.targetUserId, 'account_hidden', {}, tx);
    }
  });
}

export const feedbackSchema = z.object({ page: z.string().trim().max(MAX_PAGE_LENGTH), body: z.string().trim() });

/** Feedback or an appeal from a signed-in member, with the page it is about. */
export async function submitFeedback(member: Actor, raw: unknown): Promise<void> {
  const input = feedbackSchema.parse(raw);
  const maxChars = await getSetting('feedback.maxChars');
  if (input.body.length === 0) throw new ValidationError('feedback.empty', 'Write something first.', { field: 'body' });
  if (input.body.length > maxChars) throw new ValidationError('feedback.long', `Feedback can be up to ${maxChars} characters.`, { field: 'body' });
  await insertFeedback({ userId: member.id, page: input.page === '' ? '/' : input.page, body: input.body });
}
