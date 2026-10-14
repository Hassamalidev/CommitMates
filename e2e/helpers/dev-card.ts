import { randomBytes } from 'node:crypto';

import { withAppDatabase } from './db';

/**
 * A Dev Card in the shape `analyze_profile` stores. The tests put it in the result cache,
 * so the pages are exercised end to end (request, rate limit, cache, rendering) without
 * a call to GitHub.
 */
export function cardFor(login: string, githubId: number) {
  const hourHist = new Array<number>(24).fill(0);
  hourHist[22] = 0.5;
  hourHist[23] = 0.25;
  hourHist[9] = 0.25;
  return {
    login,
    name: 'Fixture User',
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}?v=4`,
    githubId,
    isMember: false,
    timezone: 'UTC',
    timezoneSource: 'utc',
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
    companion: { seed: githubId, speciesKey: 'react', paletteHex: '#3178c6', stage: 2, traits: [] },
    calendar90: Array.from({ length: 90 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 6, 17 + index)).toISOString().slice(0, 10),
      count: index % 2 === 0 ? 2 : 0,
    })),
  };
}

export async function cacheCard(login: string, githubId: number): Promise<void> {
  await withAppDatabase(async (sql) => {
    await sql`
      insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
      values ('dev_card', ${login.toLowerCase()}, 'default', ${sql.json(cardFor(login, githubId))}, false, now(), now() + interval '1 hour')
      on conflict (kind, subject_key, params_hash) do update set result = excluded.result, expires_at = excluded.expires_at`;
    // Every test run shares one address; start each with a full bucket.
    await sql`delete from rate_limit_buckets where key like 'tool:dev-card:%'`;
  });
}

export const uniqueLogin = () => `e2e-card-${randomBytes(4).toString('hex')}`;
