import { getSetting } from '@commitmates/db';
import { fetchStarredRepos, githubFor, type StarredRepo } from '@commitmates/github';
import { PRIORITY, type JobContext, type JobHandler } from '@commitmates/jobs';

import { getCachedDevCard, identityFor, readProfile, storeDevCard } from '../persona/jobs';
import type { DevCard } from '../persona/schemas';
import { hourBucket, storeToolResult, type ToolDefinition } from '../tools/service';

import { compatInputSchema, compatPayloadSchema, compatResultSchema, type CompatInput, type CompatPayload } from './schemas';
import { buildCompat } from './service';

/** Time kept in hand before the deadline: reading one more profile must not start later than this. */
const PROFILE_MARGIN_MS = 10_000;

/** The steps `compat_check` reports, in order. */
export const COMPAT_STEPS = { first: 'first', second: 'second', stars: 'stars', comparing: 'comparing' } as const;

const sortedPair = (input: { a: string; b: string }): [string, string] => {
  const [x, y] = [input.a.toLowerCase(), input.b.toLowerCase()].sort();
  return [x ?? '', y ?? ''];
};

export const compatTool: ToolDefinition<CompatInput> = {
  slug: 'compat',
  jobType: 'compat_check',
  cacheKind: 'compat',
  input: compatInputSchema,
  // The same two people in either order are one result (CLAUDE.md §8 F2 "Output").
  subjectKey: (input) => sortedPair(input).join(':'),
  idempotencyKey: (input, now) => `compat:${sortedPair(input).join(':')}:${hourBucket(now)}`,
  payload: (input, context) => ({ ...input, ...(context.userId !== undefined ? { requestedBy: context.userId } : {}) }),
  ttlSetting: 'cache.compatTtlHours',
};

/** A person's Dev Card: the cached one when it is fresh and complete, else read and stored now. */
async function cardFor(
  login: string,
  field: 'a' | 'b',
  payload: CompatPayload,
  ctx: JobContext,
): Promise<{ card: DevCard; built: boolean }> {
  const cached = await getCachedDevCard(login, ctx.now());
  if (cached) return { card: cached, built: false };
  const snapshot = await readProfile(login, { identity: await identityFor(login, payload.requestedBy), ctx, field });
  return { card: (await storeDevCard(snapshot, ctx.now())).card, built: true };
}

async function starredOf(login: string, payload: CompatPayload, ctx: JobContext): Promise<StarredRepo[]> {
  const client = githubFor(await identityFor(login, payload.requestedBy), { now: ctx.now });
  return fetchStarredRepos(client, login, { cap: await getSetting('matching.starCap'), deadline: ctx.deadline });
}

/**
 * Compares two people (CLAUDE.md §8 F2). Dev Cards are reused from the cache; a missing
 * one is built and cached on the way, and when time runs short the job continues in a
 * follow-up that finds the first card already cached.
 */
export const compatCheckJob: JobHandler<CompatPayload> = {
  type: 'compat_check',
  schema: compatPayloadSchema,
  priority: PRIORITY.INTERACTIVE,
  async run(payload, ctx) {
    await ctx.progress({ step: COMPAT_STEPS.first, message: `Reading @${payload.a}` });
    const first = await cardFor(payload.a, 'a', payload, ctx);

    // Only worth a follow-up when this run did real work: the next one starts with that card cached.
    if (first.built && Date.now() > ctx.deadline - PROFILE_MARGIN_MS) return { kind: 'continue', payload };
    await ctx.progress({ step: COMPAT_STEPS.second, message: `Reading @${payload.b}` });
    const { card: cardB } = await cardFor(payload.b, 'b', payload, ctx);
    const cardA = first.card;

    await ctx.progress({ step: COMPAT_STEPS.stars });
    const [starredA, starredB] = [await starredOf(cardA.login, payload, ctx), await starredOf(cardB.login, payload, ctx)];

    await ctx.progress({ step: COMPAT_STEPS.comparing });
    const result = compatResultSchema.parse(await buildCompat({ card: cardA, starred: starredA }, { card: cardB, starred: starredB }));
    // A comparison involving someone who has not signed up is kept no longer than their raw data (CLAUDE.md §8 F2 "Privacy").
    const resultRef = await storeToolResult(compatTool, { a: payload.a, b: payload.b }, result, {
      isMemberSubject: cardA.isMember && cardB.isMember,
      now: ctx.now(),
    });
    return { kind: 'done', resultRef };
  },
};
