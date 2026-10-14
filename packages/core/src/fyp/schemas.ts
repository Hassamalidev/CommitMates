import { z } from 'zod';

/** Limits of an idea (CLAUDE.md §8 F9 "Input"). */
export const FYP_TITLE_MAX = 120;
/** Shortest description that says enough to compare. */
export const FYP_DESCRIPTION_MIN = 50;
/** Longest description accepted. */
export const FYP_DESCRIPTION_MAX = 3000;

export const fypInputSchema = z.object({
  title: z.string().trim().min(1, 'Give your idea a title.').max(FYP_TITLE_MAX, `Keep the title under ${FYP_TITLE_MAX} characters.`),
  description: z
    .string()
    .trim()
    .min(FYP_DESCRIPTION_MIN, `Describe the idea in at least ${FYP_DESCRIPTION_MIN} characters: what it does, for whom, and how.`)
    .max(FYP_DESCRIPTION_MAX, `Keep the description under ${FYP_DESCRIPTION_MAX} characters.`),
});
export type FypInput = z.infer<typeof fypInputSchema>;

export const fypResultSchema = z.object({
  keyphrases: z.array(z.string()),
  /** The language whose stopwords were used, by ISO 639-1 code. */
  language: z.string(),
  results: z.array(
    z.object({
      fullName: z.string(),
      description: z.string().nullable(),
      stars: z.number().int().min(0),
      /** 0–100: how close the README is to the idea, relative to the idea itself. */
      similarity: z.number().min(0).max(100), // allowed-literal: a percentage
      // allowed-literal: schema enum of the similarity bands
      band: z.enum(['very-similar', 'related', 'loose']),
      sharedKeyphrases: z.array(z.string()),
    }),
  ),
  /** The idea's keyphrases found in none of the closest projects: what makes it different. */
  unique: z.array(z.string()),
});
export type FypResult = z.infer<typeof fypResultSchema>;
