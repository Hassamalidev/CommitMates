import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  getDb,
  getReport,
  getSetting,
  insertNotification,
  liftExpiredSuspensions,
  listOpenReportGroups,
  messageContext,
  resolveOpenReports,
  setAccountStatus,
  writeAudit,
  type ContextMessage,
  type ReportGroup,
} from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { getMember, hasRole } from '../profiles/service';
import type { Member } from '../profiles/schemas';

import { moderationScope } from './roles';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Longest note a moderator can attach to a decision. */
const MAX_NOTE_LENGTH = 500;

type Actor = Pick<Member, 'id' | 'roles'>;

const outOfScope = () => new ForbiddenError('moderation.out_of_scope', "That member is not at a university you moderate.");

/** Whether the actor may moderate a member of `universityId` (§5.11): admins anyone, moderators their universities. */
function inScope(actor: Actor, universityId: string | null): boolean {
  if (hasRole(actor, 'admin')) return true;
  return universityId !== null && hasRole(actor, { role: 'uni_moderator', universityId });
}

/**
 * The moderation queue (CLAUDE.md §8 F12 "Moderation queue"): open reports grouped by the reported
 * member, limited to the actor's scope.
 */
export async function getModerationQueue(actor: Actor): Promise<{ scope: Awaited<ReturnType<typeof moderationScope>>; groups: ReportGroup[] }> {
  const scope = await moderationScope(actor);
  const groups = await listOpenReportGroups(scope.admin ? null : scope.universities.map((university) => university.id));
  return { scope, groups };
}

export const reportContextSchema = z.object({ reportId: z.uuid() });

/**
 * The reported message with the messages around it, for the moderator handling the report. Private
 * messages are read only here, only within scope, and every reading is audited.
 */
export type ReportContextLine = ContextMessage & { reported: boolean };

export async function viewReportContext(actor: Actor, raw: unknown): Promise<ReportContextLine[]> {
  const { reportId } = reportContextSchema.parse(raw);
  const report = await getReport(reportId);
  if (!report) throw new NotFoundError('moderation.report_missing', 'That report no longer exists.');
  if (!inScope(actor, report.universityId)) throw outOfScope();
  if (report.targetMessage === null) return [];
  const around = await getSetting('safety.contextMessages');
  const messages = await messageContext(report.targetMessage, around);
  await writeAudit({ actorUserId: actor.id, action: 'moderation.context_viewed', targetType: 'report', targetId: report.id, data: { messages: messages.length } });
  return messages.map((message) => ({ ...message, reported: message.id === report.targetMessage }));
}

export const MODERATION_ACTIONS = ['dismiss', 'warn', 'suspend', 'ban'] as const; // allowed-literal: the actions §8 F12 names
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const moderationActionSchema = z.object({
  targetUserId: z.uuid(),
  action: z.enum(MODERATION_ACTIONS),
  days: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).default(''),
});

/**
 * Acts on the open reports about a member (CLAUDE.md §8 F12 "Moderation queue"):
 * - dismiss: the reports are dismissed; an account hidden by them is restored;
 * - warn: the member is told, and an account hidden by the reports is restored;
 * - suspend: the account is suspended for `days` (at most `safety.maxSuspensionDays`);
 * - ban: the account is suspended with no end.
 * Moderators act only within their universities and never on admins or themselves. Every decision
 * is written to the audit log with the reports it resolved.
 */
export async function moderate(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ resolved: number }> {
  const input = moderationActionSchema.parse(raw);
  if (input.targetUserId === actor.id) throw new ValidationError('moderation.self', "You can't moderate your own account.");
  const target = await getMember(input.targetUserId);
  if (!target) throw new NotFoundError('moderation.member_missing', "We couldn't find that member.");
  if (!inScope(actor, target.universityId)) throw outOfScope();
  if (hasRole(target, 'admin') && !hasRole(actor, 'admin')) {
    throw new ForbiddenError('moderation.admin_target', 'Only an admin can act on an admin account.');
  }
  let until: Date | null = null;
  if (input.action === 'suspend') {
    const maxDays = await getSetting('safety.maxSuspensionDays');
    if (typeof input.days !== 'number' || input.days > maxDays) {
      throw new ValidationError('moderation.days', `Choose between 1 and ${maxDays} days.`, { field: 'days' });
    }
    until = new Date(now.getTime() + input.days * MS_PER_DAY);
  }

  return getDb().transaction(async (tx) => {
    const resolved = await resolveOpenReports(target.id, input.action === 'dismiss' ? 'dismissed' : 'actioned', actor.id, now, tx);
    if (input.action === 'dismiss' || input.action === 'warn') {
      if (target.status === 'hidden_pending_review') {
        await setAccountStatus(target.id, 'active', null, tx);
        await insertNotification(target.id, 'account_restored', {}, tx);
      }
      if (input.action === 'warn') await insertNotification(target.id, 'moderation_warning', { note: input.note }, tx);
    } else {
      await setAccountStatus(target.id, 'suspended', until, tx);
    }
    await writeAudit(
      {
        actorUserId: actor.id,
        action: `moderation.${input.action}`,
        targetType: 'user',
        targetId: target.id,
        data: { resolved, until: until?.toISOString() ?? null, note: input.note, previousStatus: target.status },
      },
      tx,
    );
    return { resolved };
  });
}

const emptyPayload = z.object({});

/** Hourly: suspensions whose time is up end, each recorded in the audit log. Bans stay. */
export const liftSuspensionsJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'lift_suspensions',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const lifted = await getDb().transaction(async (tx) => {
      const ids = await liftExpiredSuspensions(ctx.now(), tx);
      for (const id of ids) {
        await writeAudit({ actorUserId: null, action: 'moderation.suspension_lifted', targetType: 'user', targetId: id }, tx);
      }
      return ids.length;
    });
    return { kind: 'done', resultRef: { lifted } };
  },
};
