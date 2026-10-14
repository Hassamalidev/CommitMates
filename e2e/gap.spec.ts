import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

test.describe('Gap Finder', () => {
  test('shows what similar projects have, with examples and what is already right', async ({ page }) => {
    const repo = `e2e-me/app-${randomBytes(3).toString('hex')}`;
    const result = {
      repo: { fullName: repo, githubId: 1 },
      peers: [
        { fullName: 'a/one', stars: 500 },
        { fullName: 'b/two', stars: 300 },
      ],
      gaps: [{ facet: 'dir:tests', kind: 'path', name: 'tests', topic: null, prevalence: 1, peersWith: 2, examples: ['a/one', 'b/two'] }],
      shared: [{ facet: 'meta:license', kind: 'meta', name: 'license', topic: null, prevalence: 1, peersWith: 2 }],
      lowConfidence: false,
    };
    await withAppDatabase(async (sql) => {
      await sql`
        insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
        values ('gap', ${repo.toLowerCase()}, 'default', ${sql.json(result)}, false, now(), now() + interval '1 hour')`;
      await sql`delete from rate_limit_buckets where key like 'tool:gap:%'`;
    });
    try {
      await page.goto(`/tools/gap?repo=${encodeURIComponent(repo)}`);
      const view = page.getByTestId('gap-result');
      await expect(view.getByText('A tests/ folder')).toBeVisible();
      await expect(view.getByText('2 of 2 similar repos have this').first()).toBeVisible();
      await view.getByText('For example:').click();
      await expect(view.getByRole('link', { name: 'a/one' }).first()).toHaveAttribute('href', 'https://github.com/a/one');
      await expect(view.getByText('A license')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Who at your uni can help' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'gap' and subject_key = ${repo.toLowerCase()}`);
    }
  });
});
