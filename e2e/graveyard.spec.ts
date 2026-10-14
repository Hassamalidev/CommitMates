import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

const item = (fullName: string, overrides: Record<string, unknown> = {}) => ({
  fullName,
  description: 'An object tracker',
  stars: 40,
  forks: 3,
  openIssues: 6,
  licenseSpdx: 'MIT',
  archived: false,
  pushedAt: '2025-08-01T00:00:00Z',
  idleMonths: 14.2,
  category: 'computer-vision',
  difficulty: 'half-built',
  unfinished: 0.7,
  revivability: 0.62,
  rank: 0.62,
  signals: { readmeUnfinished: true, unansweredIssues: 0.5, unfinishedCommits: 0.25, noReleases: true },
  ...overrides,
});

test.describe('Project Graveyard', () => {
  test('lists inactive projects with filters and adoption links, and keeps other scopes locked', async ({ page }) => {
    const query = `e2e vision ${randomBytes(3).toString('hex')}`;
    const subject = `global:${query}`;
    await withAppDatabase(async (sql) => {
      const result = {
        query,
        scope: 'global',
        terms: ['computer-vision'],
        items: [item('someone/half-vision'), item('someone/no-license', { licenseSpdx: null, difficulty: 'weekend-fix' })],
        suggestions: [],
      };
      await sql`
        insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
        values ('graveyard', ${subject}, 'default', ${sql.json(result)}, false, now(), now() + interval '1 hour')`;
      await sql`delete from rate_limit_buckets where key like 'tool:graveyard:%'`;
    });
    try {
      await page.goto(`/tools/graveyard?q=${encodeURIComponent(query)}`);
      await expect(page.getByTestId('graveyard-item')).toHaveCount(2);
      const first = page.getByRole('article', { name: 'someone/half-vision' });
      await expect(first.getByRole('link', { name: 'Fork on GitHub' })).toHaveAttribute('href', 'https://github.com/someone/half-vision/fork');
      await expect(first.getByRole('link', { name: 'Ask the owner' })).toHaveAttribute('href', /issues\/new\?title=Is\+this\+project\+still\+maintained/);
      await expect(page.getByRole('article', { name: 'someone/no-license' }).getByRole('link', { name: 'Ask the owner first' })).toBeVisible();

      await page.getByLabel('License', { exact: true }).selectOption('unlicensed');
      await expect(page.getByTestId('graveyard-item')).toHaveCount(1);

      await expectNoSeriousA11yViolations(page);
      await page.getByRole('tab', { name: 'My uni' }).click();
      await expect(page.getByRole('heading', { name: 'Projects from your university' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'graveyard' and subject_key = ${subject}`);
    }
  });
});
