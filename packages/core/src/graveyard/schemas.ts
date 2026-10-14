import { MIN_TERM_LENGTH } from '@commitmates/algorithms';
import { z } from 'zod';

/** Longest search a person may type. */
const MAX_QUERY_CHARS = 100;

// allowed-literal: schema enum of the three search scopes (§8 F7)
export const GRAVEYARD_SCOPES = ['global', 'country', 'uni'] as const;

export const graveyardInputSchema = z.object({
  q: z.string().trim().min(MIN_TERM_LENGTH, 'Search for at least two characters.').max(MAX_QUERY_CHARS),
  scope: z
    .enum(GRAVEYARD_SCOPES)
    .default('global')
    // The country index and university listings arrive with later phases; their tabs show unlock cards.
    .refine((scope) => scope === 'global', 'This scope unlocks later. Search everywhere for now.'),
});
export type GraveyardInput = z.infer<typeof graveyardInputSchema>;

export const graveyardPayloadSchema = z.object({ q: z.string().min(1), scope: z.enum(GRAVEYARD_SCOPES) });
export type GraveyardPayload = z.infer<typeof graveyardPayloadSchema>;

const share = z.number().min(0).max(1);

export const graveyardItemSchema = z.object({
  fullName: z.string(),
  description: z.string().nullable(),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  openIssues: z.number().int().min(0),
  licenseSpdx: z.string().nullable(),
  archived: z.boolean(),
  pushedAt: z.string().nullable(),
  idleMonths: z.number().min(0),
  category: z.string(),
  // allowed-literal: schema enum of difficulty labels
  difficulty: z.enum(['weekend-fix', 'needs-maintainer', 'half-built']).nullable(),
  unfinished: share,
  revivability: z.number().min(0),
  rank: z.number().min(0),
  /** Why it is here: the signals behind the unfinished score. */
  signals: z.object({
    readmeUnfinished: z.boolean(),
    unansweredIssues: share.nullable(),
    unfinishedCommits: share.nullable(),
    noReleases: z.boolean(),
  }),
});
export type GraveyardItem = z.infer<typeof graveyardItemSchema>;

export const graveyardResultSchema = z.object({
  query: z.string(),
  scope: z.enum(GRAVEYARD_SCOPES),
  /** Topics the search was widened with. */
  terms: z.array(z.string()),
  items: z.array(graveyardItemSchema),
  /** Broader terms to try when nothing was found. */
  suggestions: z.array(z.string()),
});
export type GraveyardResult = z.infer<typeof graveyardResultSchema>;
