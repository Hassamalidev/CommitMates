import { parseGitHubUrl } from '@commitmates/github';
import { z } from 'zod';

/** Input of the Group Fairness Report (CLAUDE.md §8 F4): a public repository on GitHub. */
export const fairnessInputSchema = z.object({
  repoUrl: z
    .string()
    .trim()
    .min(1, 'Paste a GitHub repository link.')
    .refine((value) => parseGitHubUrl(value) !== null, 'That does not look like a GitHub repository link.'),
});
export type FairnessInput = z.infer<typeof fairnessInputSchema>;

const lineCounts = z.tuple([z.number(), z.number()]);

/** The job's payload. Continuations carry what per-commit reading has found so far. */
export const fairnessPayloadSchema = fairnessInputSchema.extend({
  cursor: z.number().int().nonnegative().optional(),
  /** Net lines (outside excluded paths) of each commit read so far, by sha. */
  lines: z.record(z.string(), lineCounts).optional(),
  /** Lines in excluded paths per person. */
  excluded: z.record(z.string(), lineCounts).optional(),
  /** Distinct files changed per person; `null` once there were too many to track. */
  files: z.record(z.string(), z.array(z.string())).nullable().optional(),
});
export type FairnessPayload = z.infer<typeof fairnessPayloadSchema>;

const contributorSchema = z.object({
  key: z.string(),
  login: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  isBot: z.boolean(),
  commits: z.number().min(0),
  additions: z.number().min(0).nullable(),
  deletions: z.number().min(0).nullable(),
  weekly: z.array(z.number().min(0)),
  filesTouched: z.number().int().min(0).nullable(),
});

/** The stored report (CLAUDE.md §8 F4). Team metrics are computed where it is shown, so merges can redo them. */
export const fairnessResultSchema = z.object({
  repo: z.object({ fullName: z.string(), githubId: z.number().int() }),
  /** `stats`: GitHub's contributor statistics; `commits`: only the recent commit list (very large repositories). */
  // allowed-literal: schema enum of the data source
  mode: z.enum(['stats', 'commits']),
  /** Week starts (`YYYY-MM-DD`, Sundays), aligned with every contributor's `weekly`. */
  weeks: z.array(z.string()),
  contributors: z.array(contributorSchema),
  commitsAnalyzed: z.number().int().min(0),
  excludedPaths: z.number().int().min(0),
  excludedLines: z.number().int().min(0),
  coAuthorCredits: z.number().int().min(0),
});
export type FairnessResult = z.infer<typeof fairnessResultSchema>;
