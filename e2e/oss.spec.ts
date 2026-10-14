import { createHash, randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

/** The cache key of a result's parameters, as `hashParams` in packages/core computes it (keys sorted). */
const paramsHash = (params: Record<string, unknown>) =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)))))
    .digest('hex');

test.describe('Open-Source Starter', () => {
  test('shows beginner issues with how fast maintainers reply', async ({ page }) => {
    const login = `e2e-oss-${randomBytes(3).toString('hex')}`;
    const subject = `login:${login}`;
    const result = {
      languages: ['TypeScript'],
      topics: [],
      relaxed: [],
      issues: [
        {
          repo: 'fast/web',
          number: 1,
          title: 'Add a dark mode toggle',
          url: 'https://github.com/fast/web/issues/1',
          labels: ['good first issue'],
          comments: 0,
          ageDays: 2,
          responseHours: 5,
          skillMatch: 1,
          rank: 0.9,
        },
      ],
    };
    await withAppDatabase(async (sql) => {
      await sql`
        insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
        values ('oss', ${subject}, ${paramsHash({ languages: [], topics: [] })}, ${sql.json(result)}, false, now(), now() + interval '1 hour')`;
      await sql`delete from rate_limit_buckets where key like 'tool:oss:%'`;
    });
    try {
      await page.goto(`/tools/oss?login=${login}`);
      const card = page.getByRole('article', { name: 'Add a dark mode toggle' });
      await expect(card.getByRole('link', { name: 'Add a dark mode toggle' })).toHaveAttribute('href', 'https://github.com/fast/web/issues/1');
      await expect(card.getByText('Maintainers usually reply in about 5 hours')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'oss' and subject_key = ${subject}`);
    }
  });

  test('asks for a username or a language', async ({ page }) => {
    await withAppDatabase((sql) => sql`delete from rate_limit_buckets where key like 'tool:oss:%'`);
    await page.goto('/tools/oss');
    await page.getByRole('button', { name: 'Find issues' }).click();
    await expect(page.getByText('Enter a GitHub username or pick at least one language.')).toBeVisible();
  });
});
