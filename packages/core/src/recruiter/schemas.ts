import { z } from 'zod';

import { loginSchema } from '../persona/schemas';

/** Claimed skills a person may paste (CLAUDE.md §8 F3 "Input"). */
export const MAX_RESUME_SKILLS = 30;
/** Longest single claimed skill, in characters. */
const MAX_SKILL_CHARS = 60;

export const recruiterInputSchema = z.object({
  login: loginSchema,
  resumeSkills: z
    .array(z.string().trim().min(1).max(MAX_SKILL_CHARS))
    .max(MAX_RESUME_SKILLS, `Up to ${MAX_RESUME_SKILLS} skills.`)
    .optional(),
  /** Asks for the secret scan; it runs only when the signed-in member checks their own account. */
  scanSecrets: z.boolean().optional(),
});
export type RecruiterInput = z.infer<typeof recruiterInputSchema>;

export const recruiterPayloadSchema = recruiterInputSchema.extend({
  requestedBy: z.uuid().optional(),
});
export type RecruiterPayload = z.infer<typeof recruiterPayloadSchema>;

const evidenceValue = z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(z.string())]);

export const ruleResultSchema = z.object({
  key: z.string(),
  applicable: z.boolean(),
  credit: z.number().min(0).max(1),
  weight: z.number(),
  // allowed-literal: schema enum of a rule's outcome
  status: z.enum(['pass', 'partial', 'fail', 'not-applicable']),
  evidence: z.record(z.string(), evidenceValue),
});

/**
 * The stored report (CLAUDE.md §8 F3). Never holds a secret or where one is: secret findings
 * are kept apart, readable only by the account's owner.
 */
export const recruiterResultSchema = z.object({
  login: z.string(),
  githubId: z.number().int(),
  isMember: z.boolean(),
  /** 0–100; `null` when no rule applies. */
  score: z.number().int().min(0).max(100).nullable(), // allowed-literal: a score out of 100
  rules: z.array(ruleResultSchema),
  /** True when the account has no pinned repositories and the top ones by stars were used. */
  usedTopRepos: z.boolean(),
  /** Set when this run included the owner's secret scan, so the page knows to show it. */
  secretScanRan: z.boolean(),
});
export type RecruiterResult = z.infer<typeof recruiterResultSchema>;
