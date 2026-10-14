import { buildDecks, mulberry32, seedFrom, shuffled, topTags, universityGaps, type MatchProfile } from '@commitmates/algorithms';
import { excludedPairs, getSetting, matchPool, saveSuggestions, universitiesWithMembers, type PoolMember } from '@commitmates/db';
import { PRIORITY, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { utcDay } from '../notifications/email';

/** Without goals, the university's 20 strongest tags minus the member's own stand in (§8 F11 "Scoring"). */
const UNIVERSITY_TOP_TAGS = 20;

/** The university's strongest tags: the sum of its members' vectors. */
function universityTopTags(pool: readonly PoolMember[]): string[] {
  const sums: Record<string, number> = {};
  for (const member of pool) for (const [tag, weight] of Object.entries(member.vector)) sums[tag] = (sums[tag] ?? 0) + weight;
  return topTags(sums, UNIVERSITY_TOP_TAGS);
}

/** One university's decks for a day (§8 F11 "Deck"). Returns how many suggestions were stored. */
export async function buildUniversityDecks(universityId: string, day: string): Promise<number> {
  const [pool, excluded, deckSize, maxImpressions, weights] = await Promise.all([
    matchPool(universityId),
    excludedPairs(universityId),
    getSetting('matching.deckSize'),
    getSetting('matching.maxDailyImpressions'),
    getSetting('matching.weights'),
  ]);
  const uniTags = universityTopTags(pool);
  const invisible = new Set(pool.filter((member) => member.invisible).map((member) => member.userId));
  const profiles: MatchProfile[] = pool.map((member) => ({
    id: member.userId,
    vector: member.vector,
    topTags: member.topTags,
    interests: member.interests,
    goals: member.learningGoals.length > 0 ? member.learningGoals : universityGaps(uniTags, member.topTags),
  }));
  // A seeded order, so who is served first (and gets scarce people) changes daily but can be replayed.
  const order = shuffled(profiles, mulberry32(seedFrom(`${day}:${universityId}`)));
  const decks = buildDecks({
    order,
    weights,
    deckSize,
    maxImpressions,
    excluded: (userId, candidateId) => invisible.has(candidateId) || excluded.has(`${userId}|${candidateId}`),
  });
  return saveSuggestions(
    decks.map((entry) => ({
      userId: entry.userId,
      candidateUserId: entry.candidateId,
      mode: entry.mode,
      score: entry.score,
      components: entry.components,
      explanationKeys: entry.explanation,
      shownOn: day,
    })),
  );
}

const payloadSchema = z.object({
  /** Set on a continuation: the day being built and the universities still to do. */
  day: z.string().optional(),
  universityIds: z.array(z.uuid()).optional(),
});

/** Time kept in hand before the deadline; a university's decks are built in one go. */
const DEADLINE_MARGIN_MS = 5000;

/**
 * Nightly: builds the day's decks for every university where matching is unlocked. When time runs
 * short, the remaining universities continue in a follow-up job for the same day.
 */
export const matchDailyJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'match_daily',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    const day = payload.day ?? utcDay(ctx.now());
    const universities = payload.universityIds ?? (await universitiesWithMembers(await getSetting('unlock.matching.minMembers')));
    let stored = 0;
    for (const [index, universityId] of universities.entries()) {
      if (index > 0 && Date.now() > ctx.deadline - DEADLINE_MARGIN_MS) {
        return { kind: 'continue', payload: { day, universityIds: universities.slice(index) } };
      }
      stored += await buildUniversityDecks(universityId, day);
    }
    return { kind: 'done', resultRef: { universities: universities.length, stored } };
  },
};
