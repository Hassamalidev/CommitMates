import { z } from 'zod';

import { devCardSchema, loginSchema } from '../persona/schemas';

/** Input of the Compatibility Check (CLAUDE.md §8 F2): two different GitHub users. */
export const compatInputSchema = z
  .object({ a: loginSchema, b: loginSchema })
  .refine((input) => input.a.toLowerCase() !== input.b.toLowerCase(), {
    message: 'Enter two different usernames.',
    path: ['b'],
  });
export type CompatInput = z.infer<typeof compatInputSchema>;

export const compatPayloadSchema = z.object({
  a: loginSchema,
  b: loginSchema,
  /** The signed-in member who asked; their own token is used for their own profile. */
  requestedBy: z.uuid().optional(),
});
export type CompatPayload = z.infer<typeof compatPayloadSchema>;

const component = z.number().min(0).max(1).nullable();

const sideSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  githubId: z.number().int(),
  isMember: z.boolean(),
  companion: devCardSchema.shape.companion,
});
export type CompatSideSummary = z.infer<typeof sideSchema>;

/** The stored result (CLAUDE.md §8 F2 "Output"). Components that could not be computed are `null`. */
export const compatResultSchema = z.object({
  a: sideSchema,
  b: sideSchema,
  /** 0–100; `null` when no component could be computed. */
  score: z.number().int().min(0).max(100).nullable(), // allowed-literal: a score out of 100
  band: z.string().nullable(),
  components: z.object({ skill: component, interest: component, rhythm: component, complement: component }),
  explanations: z.object({
    sharedTags: z.array(z.string()),
    sharedStars: z.array(z.string()),
    /** Both are more active than usual in these hours, in UTC; the page converts them to the viewer's time. */
    window: z.object({ startHourUtc: z.number().int().min(0), hours: z.number().int().min(1) }).nullable(),
    strengthA: z.string().nullable(),
    strengthB: z.string().nullable(),
  }),
});
export type CompatResult = z.infer<typeof compatResultSchema>;
