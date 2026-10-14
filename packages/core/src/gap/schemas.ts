import { parseGitHubUrl } from '@commitmates/github';
import { z } from 'zod';

/** Input of the Gap Finder (CLAUDE.md §8 F5): a public repository. */
export const gapInputSchema = z.object({
  repoUrl: z
    .string()
    .trim()
    .min(1, 'Paste a GitHub repository link.')
    .refine((value) => parseGitHubUrl(value) !== null, 'That does not look like a GitHub repository link.'),
});
export type GapInput = z.infer<typeof gapInputSchema>;

export const gapPayloadSchema = gapInputSchema;
export type GapPayload = z.infer<typeof gapPayloadSchema>;

const facetSchema = z.object({
  facet: z.string(),
  /** `path` for files and directories, `tag` for dependency tags, `meta` for repository properties. */
  // allowed-literal: schema enum of facet kinds
  kind: z.enum(['path', 'tag', 'meta']),
  /** The path or tag itself, or the property name for `meta`. */
  name: z.string(),
  /** The GitHub topic it corresponds to, when one matches. */
  topic: z.string().nullable(),
  prevalence: z.number().min(0).max(1),
  peersWith: z.number().int().min(0),
});

export const gapResultSchema = z.object({
  repo: z.object({ fullName: z.string(), githubId: z.number().int() }),
  peers: z.array(z.object({ fullName: z.string(), stars: z.number().int().min(0) })),
  gaps: z.array(facetSchema.extend({ examples: z.array(z.string()) })),
  shared: z.array(facetSchema),
  /** Fewer peers than a third of `gap.peerSampleSize` were found. */
  lowConfidence: z.boolean(),
});
export type GapResult = z.infer<typeof gapResultSchema>;
export type GapFacet = z.infer<typeof facetSchema>;
