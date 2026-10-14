import { createHash, randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';

/** The cache subject of an idea, as `fypTool.subjectKey` in packages/core computes it. */
const ideaKey = (title: string, description: string) =>
  createHash('sha256').update(`${title}\n${description}`.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

test.describe('FYP Idea Checker', () => {
  test('groups similar projects by band and shows what is different', async ({ page }) => {
    const title = `Smart attendance ${randomBytes(3).toString('hex')}`;
    const description = 'A smart attendance system that recognizes students with face recognition on an edge device.';
    const subject = ideaKey(title, description);
    const result = {
      keyphrases: ['smart attendance', 'face recognition', 'edge device'],
      language: 'en',
      results: [
        { fullName: 'a/face-attendance', description: 'Attendance by face', stars: 10, similarity: 82, band: 'very-similar', sharedKeyphrases: ['smart attendance'] },
        { fullName: 'b/face-unlock', description: null, stars: 20, similarity: 45, band: 'related', sharedKeyphrases: ['face recognition'] },
      ],
      unique: ['edge device'],
    };
    await withAppDatabase(async (sql) => {
      await sql`
        insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
        values ('fyp', ${subject}, 'default', ${sql.json(result)}, false, now(), now() + interval '1 hour')`;
      await sql`delete from rate_limit_buckets where key like 'tool:fyp-check:%'`;
    });
    try {
      await page.goto('/tools/fyp-check');
      await page.getByLabel('Title').fill(title);
      await page.getByLabel('Description').fill(description);
      await page.getByRole('button', { name: 'Check idea' }).click();
      const report = page.getByTestId('fyp-result');
      await expect(report.getByRole('heading', { name: 'Very similar' })).toBeVisible();
      await expect(report.getByRole('link', { name: 'a/face-attendance' })).toHaveAttribute('href', 'https://github.com/a/face-attendance');
      await expect(report.getByText('82% similar')).toBeVisible();
      await expect(report.getByRole('heading', { name: 'What makes yours different' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'fyp' and subject_key = ${subject}`);
    }
  });

  test('asks for a longer description', async ({ page }) => {
    await withAppDatabase((sql) => sql`delete from rate_limit_buckets where key like 'tool:fyp-check:%'`);
    await page.goto('/tools/fyp-check');
    await page.getByLabel('Title').fill('Attendance');
    await page.getByLabel('Description').fill('Too short.');
    await page.getByRole('button', { name: 'Check idea' }).click();
    await expect(page.getByLabel('Description')).toHaveAttribute('aria-invalid', 'true');
  });
});
