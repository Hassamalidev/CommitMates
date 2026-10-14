import { z } from 'zod';

import { loginSchema } from '../persona/schemas';

/** Languages and topics a person may pick. */
const MAX_PICKS = 5;
/** Longest language or topic name accepted. */
const MAX_NAME_CHARS = 60;

const names = z.array(z.string().trim().min(1).max(MAX_NAME_CHARS)).max(MAX_PICKS, `Pick up to ${MAX_PICKS}.`);

/** Input of the Open-Source Starter (CLAUDE.md §8 F8): a GitHub user, or languages and topics. */
export const ossInputSchema = z
  .object({ login: loginSchema.optional(), languages: names.optional(), topics: names.optional() })
  .refine((input) => input.login !== undefined || (input.languages?.length ?? 0) > 0, {
    message: 'Enter a GitHub username or pick at least one language.',
    path: ['languages'],
  });
export type OssInput = z.infer<typeof ossInputSchema>;

export const ossPayloadSchema = z.object({
  login: z.string().optional(),
  languages: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
});
export type OssPayload = z.infer<typeof ossPayloadSchema>;

export const ossIssueSchema = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  /** The issue's labels that mark it as beginner-friendly. */
  labels: z.array(z.string()),
  comments: z.number().int().min(0),
  ageDays: z.number().min(0),
  /** Median hours the project's maintainers take to answer a newcomer; `null` when unknown. */
  responseHours: z.number().min(0).nullable(),
  skillMatch: z.number().min(0).max(1),
  rank: z.number().min(0),
});
export type OssIssue = z.infer<typeof ossIssueSchema>;

export const ossResultSchema = z.object({
  languages: z.array(z.string()),
  topics: z.array(z.string()),
  // allowed-literal: schema enum of the gates that can be relaxed
  relaxed: z.array(z.enum(['comments', 'responsiveness'])),
  issues: z.array(ossIssueSchema),
});
export type OssResult = z.infer<typeof ossResultSchema>;
