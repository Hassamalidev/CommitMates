import { NotFoundError, ValidationError } from '@commitmates/db';
import { GitHubNotFoundError, GitHubOrganizationError, SERVER_IDENTITY, type TokenIdentity } from '@commitmates/github';
import { PRIORITY, type JobContext, type JobHandler } from '@commitmates/jobs';

import { ingestProfile, type IngestStep, type ProfileSnapshot } from '../profiles/ingest';
import { getMember } from '../profiles/service';
import { getCachedResult } from '../tools/cached';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import {
  analyzeProfilePayloadSchema,
  devCardInputSchema,
  devCardSchema,
  type AnalyzeProfilePayload,
  type DevCard,
  type DevCardInput,
} from './schemas';
import { buildDevCard, recordPersonaSamples } from './service';

/** Continuations allowed before a card is built from whatever has been read so far. */
const MAX_PASSES = 3;

/** The steps `analyze_profile` reports, in order; the page shows a line for each (CLAUDE.md §8 F1 "UI states"). */
export const DEV_CARD_STEPS = {
  finding: 'finding',
  repos: 'repos',
  activity: 'activity',
  building: 'building',
} as const;

export const devCardTool: ToolDefinition<DevCardInput> = {
  slug: 'dev-card',
  jobType: 'analyze_profile',
  cacheKind: 'dev_card',
  input: devCardInputSchema,
  subjectKey: (input) => input.login.toLowerCase(),
  idempotencyKey: (input, now) => `analyze_profile:${input.login.toLowerCase()}:${hourBucket(now)}`,
  payload: (input, context) => ({ ...input, ...(context.userId !== undefined ? { requestedBy: context.userId } : {}) }),
  ttlSetting: 'cache.devCardTtlHours',
};

/** A person's cached Dev Card, if a fresh one in the current shape exists. */
export async function getCachedDevCard(login: string, now: Date = new Date()): Promise<DevCard | null> {
  const parsed = devCardSchema.safeParse(await getCachedResult(devCardTool, { login }, now));
  return parsed.success ? parsed.data : null;
}

/**
 * A member analyzing their own account spends their own GitHub budget and sees their
 * private contribution counts if they enabled them; everyone else is read with the
 * server token (CLAUDE.md §5.6).
 */
export async function identityFor(login: string, requestedBy: string | undefined): Promise<TokenIdentity> {
  if (requestedBy === undefined) return SERVER_IDENTITY;
  const member = await getMember(requestedBy);
  const own = member?.login?.toLowerCase() === login.toLowerCase();
  return own && member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY;
}

/**
 * Reads one person's profile, turning GitHub's answers about organizations and unknown
 * accounts into kind, specific messages (CLAUDE.md §5.14).
 */
export async function readProfile(
  login: string,
  options: { identity: TokenIdentity; ctx: JobContext; field?: string; onStep?: (step: IngestStep) => Promise<void> },
): Promise<ProfileSnapshot> {
  try {
    return await ingestProfile(login, {
      identity: options.identity,
      now: options.ctx.now(),
      deadline: options.ctx.deadline,
      ...(options.onStep ? { onStep: options.onStep } : {}),
    });
  } catch (error) {
    const field = options.field ?? 'login';
    if (error instanceof GitHubOrganizationError) {
      throw new ValidationError('profile.organization', `@${login} is an organization. These tools are for people.`, {
        cause: error,
        field,
      });
    }
    if (error instanceof GitHubNotFoundError) {
      throw new ValidationError('profile.not_found', `We couldn't find @${login} on GitHub. Check the spelling?`, {
        cause: error,
        field,
      });
    }
    throw error;
  }
}

/**
 * Builds, validates and stores a card from a snapshot, and adds its anonymous samples.
 * The stored card is the contract with every page that draws it, so a malformed one is
 * never cached.
 */
export async function storeDevCard(snapshot: ProfileSnapshot, now: Date): Promise<{ card: DevCard; resultRef: unknown }> {
  const card = devCardSchema.parse(await buildDevCard(snapshot));
  await recordPersonaSamples(card, now);
  const resultRef = await storeToolResult(devCardTool, { login: card.login }, card, { isMemberSubject: snapshot.isMember, now });
  return { card, resultRef };
}

/** Builds a Dev Card for one GitHub account (CLAUDE.md §8 F1). */
export const analyzeProfileJob: JobHandler<AnalyzeProfilePayload> = {
  type: 'analyze_profile',
  schema: analyzeProfilePayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    await ctx.progress({ step: DEV_CARD_STEPS.finding, message: `Finding @${payload.login}` });

    let snapshot: ProfileSnapshot;
    try {
      snapshot = await readProfile(payload.login, {
        identity: await identityFor(payload.login, payload.requestedBy),
        ctx,
        onStep: async (step) => {
          await ctx.progress({ step: step === 'events' ? DEV_CARD_STEPS.activity : DEV_CARD_STEPS.repos });
        },
      });
    } catch (error) {
      // The tool's own words for the two cases a visitor most often meets.
      if (error instanceof ValidationError && error.code === 'profile.organization') {
        throw new ValidationError('dev_card.organization', "That's an organization. Dev Cards are for people.", {
          cause: error,
          field: 'login',
        });
      }
      if (error instanceof ValidationError && error.code === 'profile.not_found') {
        throw new NotFoundError('dev_card.not_found', error.userMessage, { cause: error });
      }
      throw error;
    }

    const pass = payload.pass ?? 0;
    if (!snapshot.manifestsComplete && pass < MAX_PASSES) {
      // What was read is stored; the follow-up finds it cached and reads the rest.
      return { kind: 'continue', payload: { ...payload, pass: pass + 1 } };
    }

    await ctx.progress({ step: DEV_CARD_STEPS.building });
    const { resultRef } = await storeDevCard(snapshot, ctx.now());
    return { kind: 'done', resultRef };
  },
};
