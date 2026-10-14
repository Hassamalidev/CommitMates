import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { signInTestMember } from './helpers/session';

/**
 * A Dev Card in the shape `analyze_profile` stores. The tests put it in the result cache,
 * so the pages are exercised end to end (request, rate limit, cache, rendering) without
 * a call to GitHub.
 */
function cardFor(login: string, githubId: number) {
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

async function cacheCard(login: string, githubId: number): Promise<void> {
  await withAppDatabase(async (sql) => {
    await sql`
      insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
      values ('dev_card', ${login.toLowerCase()}, 'default', ${sql.json(cardFor(login, githubId))}, false, now(), now() + interval '1 hour')
      on conflict (kind, subject_key, params_hash) do update set result = excluded.result, expires_at = excluded.expires_at`;
    // Every test run shares one address; start each with a full bucket.
    await sql`delete from rate_limit_buckets where key like 'tool:dev-card:%'`;
  });
}

const uniqueLogin = () => `e2e-card-${randomBytes(4).toString('hex')}`;

test.describe('Dev Card tool', () => {
  test('opens from the landing page and rests until asked', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tools').getByRole('link', { name: 'Open: Dev Card' }).click();
    await expect(page).toHaveURL(/\/tools\/dev-card$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Dev Card' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'The companion is idle' })).toBeVisible();
    // The tool itself may be indexed; only results about a person are not.
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('shows a visitor a card that is not indexed and cannot be shared', async ({ page }) => {
    const login = uniqueLogin();
    await cacheCard(login, 4242);
    try {
      await page.goto(`/tools/dev-card?login=${login}`);

      const card = page.getByTestId('dev-card');
      await expect(card).toBeVisible();
      await expect(card.getByRole('heading', { name: "Fixture User's Dev Card" })).toBeVisible();
      await expect(card.getByRole('img', { name: `The companion of @${login}` })).toBeVisible();
      await expect(card.getByText('Night Owl')).toBeVisible();
      await expect(card.getByText('75% of activity between 22:00 and 04:00.')).toBeVisible();
      await expect(card.getByText(/Based on public activity in the last 90 days\./)).toBeVisible();
      await expect(card.getByText('react', { exact: true })).toBeVisible();
      await expect(page.getByRole('img', { name: 'The companion is done' }).or(page.getByRole('img', { name: 'The companion is idle' }))).toBeVisible();

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.getByRole('button', { name: /share/i })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /share/i })).toHaveCount(0);
      // Visitors are offered sign-in to keep the result.
      await expect(page.getByRole('heading', { name: 'Save and share' })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page);

      const [session] = await withAppDatabase((sql) => sql`select tool, ip_hash_day, user_id from tool_sessions order by created_at desc limit 1`);
      expect(session).toMatchObject({ tool: 'dev-card', user_id: null });
      expect(session?.ip_hash_day).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${login}`);
    }
  });

  test('reads a day of the calendar with the keyboard', async ({ page }) => {
    const login = uniqueLogin();
    await cacheCard(login, 4242);
    try {
      await page.goto(`/tools/dev-card?login=${login}`);
      const calendar = page.getByRole('slider', { name: 'Contributions per day in the last 90 days' });
      await calendar.focus();
      await page.keyboard.press('ArrowUp');
      await expect(page.getByText('Oct 14: 0 contributions')).toBeVisible();
      await page.keyboard.press('ArrowUp');
      await expect(page.getByText('Oct 13: 2 contributions')).toBeVisible();
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${login}`);
    }
  });

  test('explains an invalid username next to the field', async ({ page }) => {
    await withAppDatabase((sql) => sql`delete from rate_limit_buckets where key like 'tool:dev-card:%'`);
    await page.goto('/tools/dev-card');
    await page.getByLabel('GitHub username').fill('not a login');
    await page.getByRole('button', { name: 'Build card' }).click();
    await expect(page.getByText('That does not look like a GitHub username.')).toBeVisible();
    await expect(page.getByLabel('GitHub username')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('dev-card')).toHaveCount(0);
  });
});

test.describe('member profile page', () => {
  test('has no page for someone who never signed up', async ({ page }) => {
    const login = uniqueLogin();
    expect((await page.goto(`/u/${login}`))?.status()).toBe(404);
    // Nor a share image, even when a result about them is cached.
    await cacheCard(login, 4242);
    try {
      expect((await page.request.get(`/api/og/dev-card?login=${login}`)).status()).toBe(404);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${login}`);
    }
  });

  test('follows the visibility its owner chose', async ({ page, context, browser, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    const githubId = 800_000_000 + Math.floor(Math.random() * 1_000_000);
    await withAppDatabase(async (sql) => {
      await sql`insert into users (id) values (${member.userId}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone, visibility) values (${member.userId}, 'UTC', 'hidden')
                on conflict (user_id) do update set visibility = 'hidden'`;
      await sql`insert into github_identities (user_id, github_id, login) values (${member.userId}, ${githubId}, ${member.login})
                on conflict (user_id) do update set login = excluded.login`;
    });
    await cacheCard(member.login, githubId);
    const visitorContext = await browser.newContext({ baseURL: baseURL ?? '' });
    const visitor = await visitorContext.newPage();
    try {
      // The owner always sees their own page, and is told when nobody else can.
      await page.goto(`/u/${member.login}`);
      await expect(page.getByRole('heading', { level: 1, name: `@${member.login}` })).toBeVisible();
      await expect(page.getByTestId('dev-card')).toBeVisible();
      await expect(page.getByText('Only you can see this page.')).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expect(page.getByLabel('GitHub username')).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);

      // Nothing about a private profile can be shared.
      await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
      expect((await visitor.request.get(`/api/og/dev-card?login=${member.login}`)).status()).toBe(404);

      // A hidden page looks like a missing one to everyone else.
      expect((await visitor.goto(`/u/${member.login}`))?.status()).toBe(404);

      await withAppDatabase((sql) => sql`update profiles set visibility = 'university' where user_id = ${member.userId}`);
      expect((await visitor.goto(`/u/${member.login}`))?.status()).toBe(404);

      await withAppDatabase(async (sql) => {
        await sql`update profiles set visibility = 'public' where user_id = ${member.userId}`;
        await sql`delete from rate_limit_buckets where key like 'tool:dev-card:%'`;
      });
      expect((await visitor.goto(`/u/${member.login}`))?.status()).toBe(200);
      await expect(visitor.getByTestId('dev-card')).toBeVisible();
      await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/);

      // A public profile can be shared, with an image.
      await expect(visitor.getByRole('button', { name: 'Share' })).toBeVisible();
      const ogUrl = await visitor.locator('meta[property="og:image"]').getAttribute('content');
      expect(ogUrl).toContain(`/api/og/dev-card?login=${member.login}`);
      const image = await visitor.request.get(`/api/og/dev-card?login=${member.login}`);
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toBe('image/png');
      expect((await image.body()).length).toBeGreaterThan(1000);
    } finally {
      await visitorContext.close();
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${member.login.toLowerCase()}`);
      await member.cleanup();
    }
  });
});
