import { NotFoundError, RateLimitError, authEmailOf, getSetting, reserveEmailSlot } from '@commitmates/db';
import { ACCOUNT_NOTICES, sendEmail, type SendResult, type TemplateData, type TemplateName } from '@commitmates/email';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** Length of `YYYY-MM-DD`, the date part of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** The UTC day a send counts against, as `YYYY-MM-DD`. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, ISO_DATE_LENGTH);

/** The next UTC midnight, when a new day's allowance starts. */
export const nextUtcMidnight = (now: Date): Date => new Date(Math.floor(now.getTime() / MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY);

/**
 * Today's sends reached `email.maxPerDay`. A `RateLimitError`, so a job waits until the next
 * day without using an attempt (CLAUDE.md §5.4 runner rule 6); the message is about email.
 */
export class EmailQuotaError extends RateLimitError {
  constructor(resetAt: Date) {
    super(resetAt, {
      resource: 'email',
      userMessage: 'We have sent as many emails as we can today. We will send this one as soon as tomorrow starts (UTC).',
    });
  }
}

/**
 * Sends one email within the daily cap (CLAUDE.md §3.2): a slot is reserved first, so the
 * provider's free quota is never exceeded, and a send beyond the cap is deferred, not lost.
 */
export async function deliverEmail<T extends TemplateName>(template: T, data: TemplateData[T], to: string, now: Date = new Date()): Promise<SendResult> {
  const cap = await getSetting('email.maxPerDay');
  if (!(await reserveEmailSlot(utcDay(now), cap))) throw new EmailQuotaError(nextUtcMidnight(now));
  return sendEmail(template, data, to);
}

const digestItem = z.object({ title: z.string().min(1), line: z.string().min(1), path: z.string().startsWith('/').optional() });

/**
 * What `send_email` may carry. The recipient is a member id, resolved at send time, and no
 * template here holds a secret: verification codes are sent by their own job, which never
 * stores the code (§5.10).
 */
export const sendEmailPayloadSchema = z.discriminatedUnion('template', [
  z.object({ userId: z.uuid(), template: z.literal('digest'), data: z.object({ items: z.array(digestItem).min(1), settingsPath: z.string().startsWith('/') }) }),
  z.object({
    userId: z.uuid(),
    template: z.literal('accountNotice'),
    data: z.object({ notice: z.enum(ACCOUNT_NOTICES), days: z.number().int().positive().optional() }),
  }),
]);

export type SendEmailPayload = z.infer<typeof sendEmailPayloadSchema>;

/** Sends one email to a member, waiting for the next day when the cap is reached. */
export const sendEmailJob: JobHandler<SendEmailPayload> = {
  type: 'send_email',
  schema: sendEmailPayloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const to = await authEmailOf(payload.userId);
    if (to === null) throw new NotFoundError('email.no_address', 'This member has no email address to send to.');
    const result =
      payload.template === 'digest'
        ? await deliverEmail('digest', payload.data, to, ctx.now())
        : await deliverEmail('accountNotice', payload.data, to, ctx.now());
    ctx.log.info({ template: payload.template }, 'email sent');
    return { kind: 'done', resultRef: { messageId: result.messageId } };
  },
};
