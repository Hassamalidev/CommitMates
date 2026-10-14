import {
  activityScore,
  companionStage,
  hourHistogram,
  isValidTimeZone,
  languageShares,
  lastDays,
  longestStreak,
  personaLabels,
  rhythmMetrics,
  skillTags,
  type LabelThresholds,
  type PersonaLabel,
} from '@commitmates/algorithms';
import {
  getLanguageColors,
  getMemberProfileByGithubId,
  getPackageTags,
  getSetting,
  metricRank,
  recordMetricSamples,
} from '@commitmates/db';
import { lookupLocation } from '@commitmates/sources';

import type { ProfileSnapshot } from '../profiles/ingest';

import type { DevCard } from './schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** GitHub's public events API covers this many days (CLAUDE.md §6.1); the card says "last 90 days". */
export const EVENTS_WINDOW_DAYS = 90;
/** Days of the contribution calendar the rhythm metrics and the mini heatmap use (§8 F1 steps 3–4). */
export const RHYTHM_WINDOW_DAYS = 90;
const UTC = 'UTC';

/** Metric keys of the anonymous samples a Dev Card contributes (CLAUDE.md §8 F1 step 10). */
export const PERSONA_SAMPLE_KEYS = {
  nightShare: 'persona.nightShare',
  morningShare: 'persona.morningShare',
  weekendShare: 'persona.weekendShare',
  cv: 'persona.cv',
  activeDayShare: 'persona.activeDayShare',
  total365: 'contrib.total365',
} as const;

export type ResolvedTimezone = { timezone: string; source: DevCard['timezoneSource'] };

/**
 * The timezone a person's activity is read in (CLAUDE.md §8 F1 step 1): a member's own
 * setting, else the timezone of their geocoded location once the paced geocoder has
 * resolved it, else UTC.
 */
export async function resolveTimezone(snapshot: ProfileSnapshot): Promise<ResolvedTimezone> {
  if (snapshot.isMember) {
    const member = await getMemberProfileByGithubId(snapshot.profile.githubId);
    if (member && isValidTimeZone(member.timezone)) return { timezone: member.timezone, source: 'profile' };
  }
  const place = await lookupLocation(snapshot.profile.location);
  if (place?.status === 'resolved' && place.timezone && isValidTimeZone(place.timezone)) {
    return { timezone: place.timezone, source: 'location' };
  }
  return { timezone: UTC, source: 'utc' };
}

async function labelThresholds(): Promise<LabelThresholds> {
  const [nightOwl, earlyBird, weekendWarrior, sprinter, marathoner] = await Promise.all([
    getSetting('persona.nightOwl.share'),
    getSetting('persona.earlyBird.share'),
    getSetting('persona.weekendWarrior.share'),
    getSetting('persona.sprinter.cv'),
    getSetting('persona.marathoner.activeDayShare'),
  ]);
  return { nightOwl, earlyBird, weekendWarrior, sprinter, marathoner };
}

/**
 * Builds the Dev Card from an ingested profile (CLAUDE.md §8 F1 "Algorithm"). Every
 * threshold comes from settings; every list (colors, tags) from synced sources.
 */
export async function buildDevCard(snapshot: ProfileSnapshot): Promise<DevCard> {
  const { profile, events } = snapshot;
  const fetchedAt = new Date(snapshot.fetchedAt);
  const { timezone, source } = await resolveTimezone(snapshot);

  const hourHist = hourHistogram(events, timezone);
  const calendar90 = lastDays(profile.contributions.days, RHYTHM_WINDOW_DAYS);
  const rhythm = rhythmMetrics(hourHist, calendar90);

  const shares = languageShares(profile.repos);
  const colors = await getLanguageColors(shares.map((language) => language.name));
  const languages = shares.map((language) => ({ ...language, color: colors.get(language.name) ?? null }));

  const packageTags = await getPackageTags(snapshot.dependencies);
  const dependencyTagsByRepo = new Map<number, string[]>();
  for (const dependency of snapshot.dependencies) {
    const tags = packageTags.get(`${dependency.ecosystem}:${dependency.name}`);
    if (!tags) continue;
    dependencyTagsByRepo.set(dependency.repoGithubId, [...(dependencyTagsByRepo.get(dependency.repoGithubId) ?? []), ...tags]);
  }
  const tags = skillTags(
    profile.repos
      .filter((repo) => !repo.isFork)
      .map((repo) => ({ dependencyTags: dependencyTagsByRepo.get(repo.githubId) ?? [], topics: repo.topics })),
  );

  const minEvents = await getSetting('persona.minEvents');
  const hasRhythm = events.length >= minEvents;
  const labels: PersonaLabel[] = hasRhythm ? personaLabels(rhythm, await labelThresholds()) : [];

  const total365 = profile.contributions.total;
  const [rank, activityRef, stageCuts] = await Promise.all([
    metricRank(PERSONA_SAMPLE_KEYS.total365, total365, 'companion.stageCuts'),
    getSetting('companion.activityRef'),
    getSetting('companion.stageCuts'),
  ]);
  const score = activityScore(total365, rank, activityRef);
  const topLanguage = languages[0];

  return {
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    githubId: profile.githubId,
    isMember: snapshot.isMember,
    timezone,
    timezoneSource: source,
    window: {
      eventsFrom: new Date(fetchedAt.getTime() - EVENTS_WINDOW_DAYS * MS_PER_DAY).toISOString(),
      eventsTo: fetchedAt.toISOString(),
    },
    languages,
    tags,
    hourHist,
    metrics: {
      ...rhythm,
      longestStreak: longestStreak(profile.contributions.days),
      total365,
      privateIncluded: profile.contributions.restricted > 0,
      events: events.length,
      activeDays90: calendar90.filter((day) => day.count > 0).length,
    },
    labels,
    enoughActivity: profile.repos.length > 0 || hasRhythm,
    reposTruncated: profile.reposTruncated,
    reposAnalyzed: profile.repos.length,
    activityScore: score,
    companion: {
      seed: profile.githubId,
      speciesKey: tags[0]?.tag ?? topLanguage?.name ?? profile.login.toLowerCase(),
      paletteHex: topLanguage?.color ?? null,
      stage: companionStage(score, stageCuts),
      // Traits come from badges (reviews, revivals, streaks), which members earn from Phase 4 on.
      traits: [],
    },
    calendar90,
  };
}

/**
 * Adds this person's numbers to the anonymous aggregates that tune the label thresholds
 * (CLAUDE.md §5.12, §8 F1 step 10). Rhythm samples are recorded only when there was
 * enough activity to measure a rhythm; one person counts once per salt period.
 */
export async function recordPersonaSamples(card: DevCard, now: Date): Promise<number> {
  const minEvents = await getSetting('persona.minEvents');
  const samples: Record<string, number> = { [PERSONA_SAMPLE_KEYS.total365]: card.metrics.total365 };
  if (card.metrics.events >= minEvents) {
    samples[PERSONA_SAMPLE_KEYS.nightShare] = card.metrics.nightShare;
    samples[PERSONA_SAMPLE_KEYS.morningShare] = card.metrics.morningShare;
    samples[PERSONA_SAMPLE_KEYS.weekendShare] = card.metrics.weekendShare;
    samples[PERSONA_SAMPLE_KEYS.cv] = card.metrics.cv;
    samples[PERSONA_SAMPLE_KEYS.activeDayShare] = card.metrics.activeDayShare;
  }
  return recordMetricSamples(card.githubId, samples, now);
}
