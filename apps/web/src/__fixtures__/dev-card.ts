import type { DevCard } from '@commitmates/core';

const hourHist = new Array<number>(24).fill(0);
hourHist[22] = 0.5;
hourHist[23] = 0.25;
hourHist[9] = 0.25;

/** A Dev Card of an invented account, in the shape `analyze_profile` stores. */
export const sampleDevCard: DevCard = {
  login: 'fixture-user-1',
  name: 'Fixture User',
  avatarUrl: 'https://avatars.githubusercontent.com/u/4242?v=4',
  githubId: 4242,
  isMember: false,
  timezone: 'Asia/Karachi',
  timezoneSource: 'location',
  window: { eventsFrom: '2026-07-16T12:00:00.000Z', eventsTo: '2026-10-14T12:00:00.000Z' },
  languages: [
    { name: 'TypeScript', share: 0.6, color: '#3178c6' },
    { name: 'Python', share: 0.3, color: '#3572A5' },
    { name: 'CSS', share: 0.1, color: null },
  ],
  tags: [
    { tag: 'react', weight: 1 },
    { tag: 'discord-bot', weight: 0.5 },
  ],
  hourHist,
  hourHistUtc: hourHist,
  topics: ['discord-bot', 'maps', 'react'],
  metrics: {
    nightShare: 0.75,
    morningShare: 0,
    weekendShare: 0.2,
    cv: 1.1,
    activeDayShare: 0.5,
    longestStreak: 6,
    total365: 1234,
    privateIncluded: false,
    events: 40,
    activeDays90: 45,
  },
  labels: [
    { key: 'nightOwl', strength: 2.1 },
    { key: 'marathoner', strength: 1 },
  ],
  enoughActivity: true,
  reposTruncated: false,
  reposAnalyzed: 3,
  activityScore: 0.6,
  companion: { seed: 4242, speciesKey: 'react', paletteHex: '#3178c6', stage: 2, traits: [] },
  calendar90: Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 17 + index)).toISOString().slice(0, 10);
    return { date, count: index % 2 === 0 ? 2 : 0 };
  }),
};
