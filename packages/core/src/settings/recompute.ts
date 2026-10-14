import {
  getSetting,
  metricPercentile,
  metricQuantiles,
  registerRecompute,
  registeredRecomputeKeys,
  settingDefault,
  type DbOrTx,
  type RecomputeFn,
  type SettingKey,
} from '@commitmates/db';

import { OSS_RESPONSE_SAMPLE } from '../oss/jobs';
import { PERSONA_SAMPLE_KEYS } from '../persona/service';
import { README_CHARS_SAMPLE } from '../recruiter/service';

/** `oss.maxResponseHours` = p60 of observed maintainer response times (CLAUDE.md §5.5.1). */
const OSS_RESPONSE_PERCENTILE = 0.6;
/** `recruiter.readme.minChars` = p40 of README lengths of well-starred repositories (§5.5.1). */
const README_PERCENTILE = 0.4;

/** A persona label threshold: the `persona.percentile` of its metric's samples (§8 F1 step 7). */
const personaThreshold =
  (metricKey: string): RecomputeFn =>
  async (db: DbOrTx) =>
    metricPercentile(metricKey, await getSetting('persona.percentile', db), db);

/**
 * Companion stage cuts: the quantiles of observed activity scores at the shares the seeded
 * cuts describe, so stages keep the same proportions of people as data arrives (§5.5.1).
 */
const stageCuts: RecomputeFn = async (db) => {
  const levels = await settingDefault('companion.stageCuts', db);
  const result = await metricQuantiles(PERSONA_SAMPLE_KEYS.activityScore, levels, db);
  return result === null ? null : { value: result.values, sampleSize: result.sampleSize };
};

const readmeTarget: RecomputeFn = async (db) => {
  const result = await metricPercentile(README_CHARS_SAMPLE, README_PERCENTILE, db);
  return result === null ? null : { value: Math.round(Number(result.value)), sampleSize: result.sampleSize };
};

/**
 * Every computed key that Phase 2 feeds. `graveyard.idleMonths.<category>` waits for push-gap
 * samples (P6); `matching.weights` and `streaks.companionStageDays` arrive with Phase 4.
 */
const RECOMPUTES: readonly [SettingKey, RecomputeFn][] = [
  ['persona.nightOwl.share', personaThreshold(PERSONA_SAMPLE_KEYS.nightShare)],
  ['persona.earlyBird.share', personaThreshold(PERSONA_SAMPLE_KEYS.morningShare)],
  ['persona.weekendWarrior.share', personaThreshold(PERSONA_SAMPLE_KEYS.weekendShare)],
  ['persona.sprinter.cv', personaThreshold(PERSONA_SAMPLE_KEYS.cv)],
  ['persona.marathoner.activeDayShare', personaThreshold(PERSONA_SAMPLE_KEYS.activeDayShare)],
  ['companion.stageCuts', stageCuts],
  ['oss.maxResponseHours', (db) => metricPercentile(OSS_RESPONSE_SAMPLE, OSS_RESPONSE_PERCENTILE, db)],
  ['recruiter.readme.minChars', readmeTarget],
];

/** Registers how each computed key is derived. Safe to call more than once. */
export function registerAllRecomputes(): void {
  const registered = new Set(registeredRecomputeKeys());
  for (const [key, compute] of RECOMPUTES) {
    if (!registered.has(key)) registerRecompute(key, compute);
  }
}
