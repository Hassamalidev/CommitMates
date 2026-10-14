import { NotFoundError, ValidationError } from '@commitmates/db';
import { GitHubNotFoundError, GitHubOrganizationError, SERVER_IDENTITY, type TokenIdentity } from '@commitmates/github';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';

import { ingestProfile } from '../profiles/ingest';
import { getMember } from '../profiles/service';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import {
  analyzeProfilePayloadSchema,
  devCardInputSchema,
  devCardSchema,
  type AnalyzeProfilePayload,
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

/**
 * A member analyzing their own account spends their own GitHub budget and sees their
 * private contribution counts if they enabled them; everyone else is read with the
 * server token (CLAUDE.md §5.6).
 */
async function identityFor(payload: AnalyzeProfilePayload): Promise<TokenIdentity> {
  if (payload.requestedBy === undefined) return SERVER_IDENTITY;
  const member = await getMember(payload.requestedBy);
  const own = member?.login?.toLowerCase() === payload.login.toLowerCase();
  return own && member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY;
}

/** Builds a Dev Card for one GitHub account (CLAUDE.md §8 F1). */
export const analyzeProfileJob: JobHandler<AnalyzeProfilePayload> = {
  type: 'analyze_profile',
  schema: analyzeProfilePayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    await ctx.progress({ step: DEV_CARD_STEPS.finding, message: `Finding @${payload.login}` });

    let snapshot;
    try {
      snapshot = await ingestProfile(payload.login, {
        identity: await identityFor(payload),
        now: ctx.now(),
        deadline: ctx.deadline,
        onStep: async (step) => {
          if (step === 'events') await ctx.progress({ step: DEV_CARD_STEPS.activity });
          else await ctx.progress({ step: DEV_CARD_STEPS.repos });
        },
      });
    } catch (error) {
      if (error instanceof GitHubOrganizationError) {
        throw new ValidationError('dev_card.organization', "That's an organization. Dev Cards are for people.", {
          cause: error,
          field: 'login',
        });
      }
      if (error instanceof GitHubNotFoundError) {
        throw new NotFoundError('dev_card.not_found', `We couldn't find @${payload.login} on GitHub. Check the spelling?`, {
          cause: error,
        });
      }
      throw error;
    }

    const pass = payload.pass ?? 0;
    if (!snapshot.manifestsComplete && pass < MAX_PASSES) {
      // What was read is stored; the follow-up finds it cached and reads the rest.
      return { kind: 'continue', payload: { ...payload, pass: pass + 1 } };
    }

    await ctx.progress({ step: DEV_CARD_STEPS.building });
    // The stored card is the contract with every page that draws it; a malformed one must not be cached.
    const card = devCardSchema.parse(await buildDevCard(snapshot));
    await recordPersonaSamples(card, ctx.now());
    const resultRef = await storeToolResult(devCardTool, { login: card.login }, card, {
      isMemberSubject: snapshot.isMember,
      now: ctx.now(),
    });
    return { kind: 'done', resultRef };
  },
};
