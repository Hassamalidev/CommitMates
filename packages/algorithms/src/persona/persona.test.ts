import { describe, expect, it } from 'vitest';

import {
  MAX_LABELS,
  activityScore,
  companionStage,
  fallbackActivityScore,
  personaLabels,
  type LabelThresholds,
} from './labels';
import {
  activeDayShare,
  dailyCv,
  eventWeight,
  hourHistogram,
  lastDays,
  longestStreak,
  morningShare,
  nightShare,
  rhythmMetrics,
  weekendShare,
  type DayCount,
  type RhythmMetrics,
} from './metrics';
import { languageShares, skillTags } from './skills';

const days = (counts: number[], start = '2026-10-05'): DayCount[] =>
  counts.map((count, index) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), count };
  });

describe('eventWeight', () => {
  it('counts a push by its commits, capped, and anything else once', () => {
    expect(eventWeight({ createdAt: 'x', commits: 3 })).toBe(3);
    expect(eventWeight({ createdAt: 'x', commits: 50 })).toBe(20);
    expect(eventWeight({ createdAt: 'x', commits: 0 })).toBe(1);
    expect(eventWeight({ createdAt: 'x' })).toBe(1);
  });
});

describe('hourHistogram', () => {
  const events = [
    { createdAt: '2026-10-14T18:00:00Z', commits: 3 },
    { createdAt: '2026-10-14T23:10:00Z', commits: 50 },
    { createdAt: '2026-10-14T02:45:00Z' },
  ];

  it('is all zeros without events', () => {
    const histogram = hourHistogram([], 'UTC');
    expect(histogram).toHaveLength(24);
    expect(histogram.every((share) => share === 0)).toBe(true);
    expect(nightShare(histogram)).toBe(0);
  });

  it('puts a single event entirely in its hour', () => {
    const histogram = hourHistogram([{ createdAt: '2026-10-14T09:59:59Z' }], 'UTC');
    expect(histogram[9]).toBe(1);
    expect(histogram.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('weights and normalizes in UTC', () => {
    const histogram = hourHistogram(events, 'UTC');
    expect(histogram[18]).toBeCloseTo(3 / 24, 12);
    expect(histogram[23]).toBeCloseTo(20 / 24, 12);
    expect(histogram[2]).toBeCloseTo(1 / 24, 12);
    expect(nightShare(histogram)).toBeCloseTo(21 / 24, 12);
    expect(morningShare(histogram)).toBe(0);
  });

  it('shifts with the timezone', () => {
    // +05:00: 18 → 23, 23 → 4, 2 → 7.
    const histogram = hourHistogram(events, 'Asia/Karachi');
    expect(histogram[23]).toBeCloseTo(3 / 24, 12);
    expect(histogram[4]).toBeCloseTo(20 / 24, 12);
    expect(nightShare(histogram)).toBeCloseTo(3 / 24, 12);
    expect(morningShare(histogram)).toBeCloseTo(1 / 24, 12);
  });

  it('skips events with unreadable timestamps', () => {
    const histogram = hourHistogram([{ createdAt: 'not a date' }, { createdAt: '2026-10-14T05:00:00Z' }], 'UTC');
    expect(histogram[5]).toBe(1);
  });

  it('keeps the hours 04:00 and 09:00 out of both night and morning', () => {
    const histogram = hourHistogram([{ createdAt: '2026-10-14T04:30:00Z' }, { createdAt: '2026-10-14T09:30:00Z' }], 'UTC');
    expect(nightShare(histogram)).toBe(0);
    expect(morningShare(histogram)).toBe(0);
  });
});

describe('daily metrics', () => {
  it('measures the weekend share of contributions', () => {
    // 2026-10-10 is a Saturday.
    expect(weekendShare(days([3, 1, 4], '2026-10-10'))).toBe(0.5);
    expect(weekendShare(days([0, 0, 4], '2026-10-10'))).toBe(0);
    expect(weekendShare([])).toBe(0);
    expect(weekendShare(days([0, 0, 0]))).toBe(0);
  });

  it('measures active days and burstiness', () => {
    expect(activeDayShare(days([1, 0, 2, 0]))).toBe(0.5);
    expect(activeDayShare([])).toBe(0);
    expect(dailyCv(days([2, 4, 4, 4, 5, 5, 7, 9]))).toBe(0.4);
    expect(dailyCv(days([0, 0, 0]))).toBe(0);
    // One burst in ten days is far burstier than steady work.
    expect(dailyCv(days([0, 0, 0, 0, 30, 0, 0, 0, 0, 0]))).toBe(3);
    expect(dailyCv(days([3, 3, 3, 3]))).toBe(0);
  });

  it('finds the longest run of active days', () => {
    expect(longestStreak(days([1, 1, 0, 1, 1, 1, 0]))).toBe(3);
    expect(longestStreak(days([0, 0]))).toBe(0);
    expect(longestStreak(days([2, 1, 5]))).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  it('takes the most recent days in date order', () => {
    const shuffled = [
      { date: '2026-10-03', count: 3 },
      { date: '2026-10-01', count: 1 },
      { date: '2026-10-02', count: 2 },
    ];
    expect(lastDays(shuffled, 2).map((day) => day.count)).toEqual([2, 3]);
    expect(lastDays(shuffled, 10)).toHaveLength(3);
    expect(lastDays(shuffled, 0)).toEqual([]);
  });

  it('bundles the five label metrics', () => {
    const histogram = hourHistogram([{ createdAt: '2026-10-14T23:00:00Z' }, { createdAt: '2026-10-14T06:00:00Z' }], 'UTC');
    expect(rhythmMetrics(histogram, days([3, 1, 4, 0], '2026-10-10'))).toEqual({
      nightShare: 0.5,
      morningShare: 0.5,
      weekendShare: 0.5,
      cv: dailyCv(days([3, 1, 4, 0])),
      activeDayShare: 0.75,
    });
  });
});

const thresholds: LabelThresholds = { nightOwl: 0.35, earlyBird: 0.3, weekendWarrior: 0.4, sprinter: 1.5, marathoner: 0.5 };
const quiet: RhythmMetrics = { nightShare: 0.1, morningShare: 0.1, weekendShare: 0.2, cv: 0.9, activeDayShare: 0.2 };

describe('personaLabels', () => {
  it('calls someone below every threshold balanced', () => {
    expect(personaLabels(quiet, thresholds)).toEqual([{ key: 'balanced', strength: 0 }]);
  });

  it('awards a label exactly at its threshold with strength 1', () => {
    expect(personaLabels({ ...quiet, nightShare: 0.35 }, thresholds)).toEqual([{ key: 'nightOwl', strength: 1 }]);
    expect(personaLabels({ ...quiet, nightShare: 0.3499 }, thresholds)).toEqual([{ key: 'balanced', strength: 0 }]);
  });

  it('orders labels by strength and keeps at most three', () => {
    const labels = personaLabels({ nightShare: 0.7, morningShare: 0.3, weekendShare: 0.6, cv: 6, activeDayShare: 0.55 }, thresholds);
    expect(labels).toHaveLength(MAX_LABELS);
    expect(labels.map((label) => label.key)).toEqual(['sprinter', 'nightOwl', 'weekendWarrior']);
    expect(labels[0]?.strength).toBe(4);
    expect(labels[1]?.strength).toBe(2);
    expect(labels[2]?.strength).toBeCloseTo(1.5, 12);
  });

  it('follows changed thresholds and ignores disabled or broken ones', () => {
    expect(personaLabels(quiet, { ...thresholds, marathoner: 0.2 })).toEqual([{ key: 'marathoner', strength: 1 }]);
    expect(personaLabels(quiet, { nightOwl: 0, earlyBird: -1, weekendWarrior: Number.NaN, sprinter: 0, marathoner: 0 })).toEqual([
      { key: 'balanced', strength: 0 },
    ]);
    expect(personaLabels({ ...quiet, cv: Number.NaN }, thresholds)).toEqual([{ key: 'balanced', strength: 0 }]);
  });
});

describe('activity score and stage', () => {
  it('uses a logarithmic scale before samples exist', () => {
    expect(fallbackActivityScore(0, 1000)).toBe(0);
    expect(fallbackActivityScore(1000, 1000)).toBe(1);
    expect(fallbackActivityScore(50_000, 1000)).toBe(1);
    expect(fallbackActivityScore(99, 9999)).toBeCloseTo(0.5, 12);
    expect(fallbackActivityScore(-5, 1000)).toBe(0);
    expect(fallbackActivityScore(10, 0)).toBe(0);
  });

  it('prefers the percentile rank once it is available', () => {
    expect(activityScore(99, null, 9999)).toBeCloseTo(0.5, 12);
    expect(activityScore(99, 0.82, 9999)).toBe(0.82);
    expect(activityScore(99, 1.4, 9999)).toBe(1);
    expect(activityScore(99, Number.NaN, 9999)).toBe(0);
  });

  it('maps the score to the first stage cut above it', () => {
    const cuts = [0.25, 0.5, 0.75, 0.9];
    expect(companionStage(0, cuts)).toBe(0);
    expect(companionStage(0.25, cuts)).toBe(1);
    expect(companionStage(0.6, cuts)).toBe(2);
    expect(companionStage(0.89, cuts)).toBe(3);
    expect(companionStage(0.9, cuts)).toBe(4);
    expect(companionStage(1, cuts)).toBe(4);
    expect(companionStage(0.6, [0.9, 0.25, 0.75, 0.5])).toBe(2);
    expect(companionStage(0.6, [])).toBe(0);
  });
});

describe('languageShares', () => {
  it('is empty without code', () => {
    expect(languageShares([])).toEqual([]);
    expect(languageShares([{ languages: {} }, { languages: { Go: 0 } }])).toEqual([]);
  });

  it('sums bytes across own repositories and skips forks', () => {
    expect(
      languageShares([
        { languages: { TypeScript: 600, CSS: 100 } },
        { languages: { Python: 300 } },
        { languages: { Rust: 9000 }, isFork: true },
      ]),
    ).toEqual([
      { name: 'TypeScript', share: 0.6 },
      { name: 'Python', share: 0.3 },
      { name: 'CSS', share: 0.1 },
    ]);
  });

  it('groups everything past the top six as other', () => {
    const languages = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, index) => [name, 80 - index * 10]));
    const shares = languageShares([{ languages }]);
    expect(shares.map((share) => share.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'other']);
    expect(shares.at(-1)?.share).toBeCloseTo(30 / 360, 12);
    expect(shares.reduce((total, share) => total + share.share, 0)).toBeCloseTo(1, 12);
  });

  it('breaks ties by name', () => {
    expect(languageShares([{ languages: { Zig: 5, Ada: 5 } }]).map((share) => share.name)).toEqual(['Ada', 'Zig']);
  });
});

describe('skillTags', () => {
  it('is empty without tags', () => {
    expect(skillTags([])).toEqual([]);
    expect(skillTags([{ dependencyTags: [], topics: [''] }])).toEqual([]);
  });

  it('weights tags by repositories and scales by the largest weight', () => {
    const tags = skillTags([
      { dependencyTags: ['react', 'react', 'maps'], topics: ['react'] },
      { dependencyTags: ['react', 'testing'], topics: [] },
      { dependencyTags: [], topics: ['discord-bot'] },
    ]);
    // react: two repos by dependency + one by topic = 3.
    expect(tags).toEqual([
      { tag: 'react', weight: 1 },
      { tag: 'discord-bot', weight: 1 / 3 },
      { tag: 'maps', weight: 1 / 3 },
      { tag: 'testing', weight: 1 / 3 },
    ]);
  });

  it('keeps the top twelve', () => {
    const topics = Array.from({ length: 20 }, (_, index) => `tag-${String(index).padStart(2, '0')}`);
    const tags = skillTags([{ dependencyTags: [], topics }, { dependencyTags: ['tag-19'], topics: [] }]);
    expect(tags).toHaveLength(12);
    expect(tags[0]).toEqual({ tag: 'tag-19', weight: 1 });
    expect(skillTags([{ dependencyTags: [], topics }], 3)).toHaveLength(3);
  });
});
