import { mergeMax, tfidfVectors, topTags } from '@commitmates/algorithms';
import {
  getDb,
  getSetting,
  membersWithStaleVectors,
  saveWeightedVectors,
  universityBases,
  upsertPersonaSnapshot,
  upsertSkillBase,
  type PersonaSnapshotInput,
} from '@commitmates/db';
import { SERVER_IDENTITY, fetchStarredRepos, githubFor, type TokenIdentity } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { loadAliasMap, normalizeTag, type AliasMap } from '@commitmates/sources';
import { z } from 'zod';

import { utcDay } from '../notifications/email';
import { getCachedDevCard, readProfile, storeDevCard } from '../persona/jobs';
import type { DevCard } from '../persona/schemas';
import { getMember } from '../profiles/service';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** `top_tags` keeps the 12 heaviest tags (CLAUDE.md §8 F11 "Vectors" step 3). */
export const TOP_SKILL_TAGS = 12;

const tagOf = (raw: string, aliases: AliasMap): string | null => {
  const tag = normalizeTag(raw);
  return tag === null ? null : (aliases.get(tag) ?? tag);
};

/**
 * A member's base term frequencies (§8 F11 step 1): language shares and skill tags from their
 * Dev Card, normalized through topic aliases so `reactjs` and `react` are one tag; when both
 * name the same tag, the larger weight wins.
 */
export function baseFromCard(card: Pick<DevCard, 'languages' | 'tags'>, aliases: AliasMap): Record<string, number> {
  const entries = [
    ...card.languages.flatMap((language) => {
      const tag = tagOf(language.name, aliases);
      return tag === null ? [] : [[tag, language.share] as const];
    }),
    ...card.tags.flatMap((skill) => {
      const tag = tagOf(skill.tag, aliases);
      return tag === null ? [] : [[tag, skill.weight] as const];
    }),
  ];
  return mergeMax(entries);
}

/** Labels kept on a snapshot, strongest first (CLAUDE.md §8 F1 step 7). */
const SNAPSHOT_LABELS = 3;

const dateOrNull = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The persona part of a member's Dev Card (§7.4 `persona_snapshots`): what other members see on a
 * Discover card, plus the UTC hour histogram for the shared-hours line.
 */
export function snapshotFromCard(card: Pick<DevCard, 'window' | 'metrics' | 'hourHistUtc' | 'labels' | 'companion'>): PersonaSnapshotInput {
  return {
    windowStart: dateOrNull(card.window.eventsFrom),
    windowEnd: dateOrNull(card.window.eventsTo),
    metrics: { ...card.metrics, hourHistUtc: card.hourHistUtc },
    labels: [...card.labels]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, SNAPSHOT_LABELS)
      .map((label) => label.key),
    companion: card.companion,
  };
}

/** Topics of owned and starred repositories, normalized (§8 F11 step 4). */
export function interestsOf(topics: readonly string[], aliases: AliasMap): string[] {
  return [...new Set(topics.flatMap((topic) => tagOf(topic, aliases) ?? []))].sort();
}

/** Recomputes TF-IDF for every verified member of a university (§8 F11 steps 2–3). */
export async function recomputeUniversityVectors(universityId: string): Promise<number> {
  const vectors = tfidfVectors(await universityBases(universityId));
  await saveWeightedVectors([...vectors].map(([userId, vector]) => ({ userId, vector, topTags: topTags(vector, TOP_SKILL_TAGS) })));
  return vectors.size;
}

const payloadSchema = z.object({ userId: z.uuid() });

/**
 * Computes a member's skill vector (job `compute_skill_vector`, on verification, sign-in and
 * weekly): their own token reads their profile and stars when it is valid, the base and interests
 * are stored, and the university's vectors are reweighted.
 */
export const computeSkillVectorJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'compute_skill_vector',
  schema: payloadSchema,
  priority: PRIORITY.USER_BG,
  async run(payload, ctx) {
    const member = await getMember(payload.userId);
    if (!member?.verified || member.universityId === null || member.login === null) {
      return { kind: 'done', resultRef: { skipped: true } };
    }
    const identity: TokenIdentity = member.hasValidToken ? { kind: 'user', userId: member.id } : SERVER_IDENTITY;
    const card = (await getCachedDevCard(member.login, ctx.now())) ?? (await storeDevCard(await readProfile(member.login, { identity, ctx }), ctx.now())).card;
    const starred = await fetchStarredRepos(githubFor(identity, { now: ctx.now }), member.login, {
      cap: await getSetting('matching.starCap'),
      deadline: ctx.deadline,
    });
    const aliases = await loadAliasMap(getDb());
    const interests = interestsOf([...card.topics, ...starred.flatMap((repo) => repo.topics)], aliases);
    await upsertSkillBase(member.id, baseFromCard(card, aliases), interests, ctx.now());
    await upsertPersonaSnapshot(member.id, snapshotFromCard(card), ctx.now());
    const members = await recomputeUniversityVectors(member.universityId);
    ctx.log.info({ members }, 'skill vectors reweighted');
    return { kind: 'done', resultRef: { members } };
  },
};

/** Queues a member's vector, once per member and day. */
export function requestSkillVector(userId: string, now: Date = new Date()) {
  return enqueue('compute_skill_vector', { userId }, { idempotencyKey: `vector:${userId}:${utcDay(now)}`, priority: PRIORITY.USER_BG });
}

const emptyPayload = z.object({});

/** Weekly: queues every verified member whose vector is older than `matching.vectorRefreshDays`. */
export const refreshSkillVectorsJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'refresh_skill_vectors',
  schema: emptyPayload,
  priority: PRIORITY.MAINTENANCE,
  async run(_payload, ctx) {
    const days = await getSetting('matching.vectorRefreshDays');
    const now = ctx.now();
    const stale = await membersWithStaleVectors(new Date(now.getTime() - days * MS_PER_DAY));
    for (const userId of stale) await requestSkillVector(userId, now);
    return { kind: 'done', resultRef: { queued: stale.length } };
  },
};
