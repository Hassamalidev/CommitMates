import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

const person = (key: string, login: string | null, commits: number, weekly: number[], name = login ?? key) => ({
  key,
  login,
  name,
  avatarUrl: null,
  isBot: false,
  commits,
  additions: commits * 10,
  deletions: commits,
  weekly,
  filesTouched: null,
});

/** A report in the shape `fairness_report` stores, put in the result cache so no GitHub call is needed. */
async function cacheReport(repo: string) {
  const result = {
    repo: { fullName: repo, githubId: 77 },
    mode: 'stats',
    weeks: ['2026-09-06', '2026-09-13', '2026-09-20'],
    contributors: [person('id:1', 'alice', 40, [20, 10, 10]), person('id:2', 'bob', 30, [10, 10, 10]), person('email:c', null, 2, [0, 0, 2], 'Bob B')],
    commitsAnalyzed: 72,
    excludedPaths: 1,
    excludedLines: 1200,
    coAuthorCredits: 0,
  };
  await withAppDatabase(async (sql) => {
    await sql`
      insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
      values ('fairness', ${repo.toLowerCase()}, 'default', ${sql.json(result)}, false, now(), now() + interval '1 hour')
      on conflict (kind, subject_key, params_hash) do update set result = excluded.result, expires_at = excluded.expires_at`;
    await sql`delete from rate_limit_buckets where key like 'tool:fairness:%'`;
  });
}

test.describe('Group Fairness Report', () => {
  test('shows a neutral report and lets the reader merge identities', async ({ page }) => {
    const repo = `e2e-team/project-${randomBytes(3).toString('hex')}`;
    await cacheReport(repo);
    try {
      await page.goto(`/tools/fairness?repo=${encodeURIComponent(`https://github.com/${repo}`)}`);
      const report = page.getByTestId('fairness-result');
      await expect(report.getByRole('heading', { name: `Code contribution report for ${repo}` })).toBeVisible();
      await expect(page.getByTestId('fairness-team').getByText(/Contribution is uneven: the smallest share is below 14% of an equal split\./)).toBeVisible();
      await expect(report.getByText('Left out 1,200 lines in generated, vendored or documentation files.')).toBeVisible();
      await expect(report.getByText(/Design, writing, testing outside the repository/)).toBeVisible();

      await page.getByLabel('Merge Bob B into (2 commits)').selectOption({ label: 'bob' });
      await expect(page.getByTestId('fairness-team').getByText('No one is far below an equal share.')).toBeVisible();

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'fairness' and subject_key = ${repo.toLowerCase()}`);
    }
  });

  test('explains a link that is not a repository next to the field', async ({ page }) => {
    await withAppDatabase((sql) => sql`delete from rate_limit_buckets where key like 'tool:fairness:%'`);
    await page.goto('/tools/fairness');
    await page.getByLabel('GitHub repository link').fill('https://example.com/not-github');
    await page.getByRole('button', { name: 'Build report' }).click();
    await expect(page.getByText('That does not look like a GitHub repository link.')).toBeVisible();
    await expect(page.getByLabel('GitHub repository link')).toHaveAttribute('aria-invalid', 'true');
  });
});
