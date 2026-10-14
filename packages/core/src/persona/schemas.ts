import { LOGIN_PATTERN } from '@commitmates/github';
import { z } from 'zod';

export const loginSchema = z
  .string()
  .trim()
  // People paste "@name" as often as "name".
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(LOGIN_PATTERN, 'That does not look like a GitHub username.'));

/** Input of the Dev Card tool (CLAUDE.md §8 F1). */
export const devCardInputSchema = z.object({ login: loginSchema });
export type DevCardInput = z.infer<typeof devCardInputSchema>;

/** Payload of `analyze_profile`: the tool input plus who asked and how often the job continued. */
export const analyzeProfilePayloadSchema = devCardInputSchema.extend({
  /** The signed-in member who asked; their own token is used when they analyze themselves. */
  requestedBy: z.uuid().optional(),
  /** Continuation passes so far, so a profile that never finishes still gets a card. */
  pass: z.number().int().nonnegative().optional(),
});
export type AnalyzeProfilePayload = z.infer<typeof analyzeProfilePayloadSchema>;

const share = z.number().min(0).max(1);

/** The stored Dev Card (CLAUDE.md §8 F1 "Output"). */
export const devCardSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  githubId: z.number().int(),
  isMember: z.boolean(),
  timezone: z.string(),
  // allowed-literal: schema enum of where the timezone came from
  timezoneSource: z.enum(['profile', 'location', 'utc']),
  /** The window GitHub's public events cover, shown as "last 90 days". */
  window: z.object({ eventsFrom: z.string(), eventsTo: z.string() }),
  languages: z.array(z.object({ name: z.string(), share, color: z.string().nullable() })),
  tags: z.array(z.object({ tag: z.string(), weight: share })),
  /** 24 shares, one per local hour. */
  hourHist: z.array(share).length(24), // allowed-literal: hours in a day
  /** The same histogram in UTC, so two people's hours can be compared (CLAUDE.md §8 F2 step 3). */
  hourHistUtc: z.array(share).length(24), // allowed-literal: hours in a day
  /** Distinct topics of the account's own repositories. */
  topics: z.array(z.string()),
  metrics: z.object({
    nightShare: share,
    morningShare: share,
    weekendShare: share,
    cv: z.number().min(0),
    activeDayShare: share,
    longestStreak: z.number().int().min(0),
    total365: z.number().int().min(0),
    privateIncluded: z.boolean(),
    events: z.number().int().min(0),
    activeDays90: z.number().int().min(0),
  }),
  /** Empty when there is too little activity to say anything (`persona.minEvents`). */
  labels: z.array(z.object({ key: z.string(), strength: z.number().min(0) })),
  /** False when the account has no public repositories and too few events for a card. */
  enoughActivity: z.boolean(),
  /** True when the account owns more repositories than were read. */
  reposTruncated: z.boolean(),
  reposAnalyzed: z.number().int().min(0),
  activityScore: share,
  companion: z.object({
    seed: z.number().int(),
    /** The top skill tag or primary language; the species is derived from it where the companion is drawn. */
    speciesKey: z.string(),
    paletteHex: z.string().nullable(),
    stage: z.number().int().min(0),
    traits: z.array(z.string()),
  }),
  calendar90: z.array(z.object({ date: z.string(), count: z.number().int().min(0) })),
});
export type DevCard = z.infer<typeof devCardSchema>;
