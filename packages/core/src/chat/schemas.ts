import { z } from 'zod';

/**
 * Where a message request was started, shown to the recipient as its context (CLAUDE.md §8 F12
 * "Message requests" step 4). Features add their kind as they arrive.
 */
export const REQUEST_CONTEXTS = ['discover', 'adoption', 'gap', 'oss'] as const;
export type RequestContext = (typeof REQUEST_CONTEXTS)[number];

export const messageRequestSchema = z.object({
  toUserId: z.uuid(),
  /** Length limits are settings, checked by the service. */
  message: z.string().trim(),
  contextKind: z.enum(REQUEST_CONTEXTS),
  contextId: z.string().min(1).nullable(),
  /** `key:value` of the icebreaker the message was filled from, if any. */
  icebreakerKey: z.string().min(1).nullable().default(null),
});
export type MessageRequestInput = z.input<typeof messageRequestSchema>;
