import { createHash, randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { signInTestMember } from './helpers/session';

/** The cache key of a result's parameters, as `hashParams` in packages/core computes it (keys sorted). */
const paramsHash = (params: Record<string, unknown>) =>
  createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)))))
    .digest('hex');

function report(login: string, secretScanRan: boolean) {
  return {
    login,
    githubId: 4242,
    isMember: false,
    score: 64,
    usedTopRepos: false,
    secretScanRan,
    rules: [
      { key: 'profileReadme', applicable: true, credit: 0, weight: 10, status: 'fail', evidence: { chars: null, min: 200 } },
      { key: 'pinnedCount', applicable: true, credit: 1, weight: 10, status: 'pass', evidence: { count: 2, min: 2, max: 6 } },
      { key: 'pinnedReadme', applicable: true, credit: 0.5, weight: 15, status: 'partial', evidence: { met: 1, total: 2, min: 600, source: 'pinned' } },
      { key: 'commitMessages', applicable: true, credit: 0.75, weight: 15, status: 'partial', evidence: { informative: 3, total: 4 } },
      { key: 'languageMatch', applicable: false, credit: 0, weight: 5, status: 'not-applicable', evidence: { matched: 0, total: 0, missing: [] } },
      { key: 'activityConsistency', applicable: true, credit: 1, weight: 10, status: 'pass', evidence: { activeDayShare: 0.5, target: 0.5 } },
    ],
  };
}

async function cacheReport(login: string, params: Record<string, unknown>, secretScanRan: boolean) {
  await withAppDatabase(async (sql) => {
    await sql`
      insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
      values ('recruiter', ${login.toLowerCase()}, ${paramsHash(params)}, ${sql.json(report(login, secretScanRan))}, false, now(), now() + interval '1 hour')
      on conflict (kind, subject_key, params_hash) do update set result = excluded.result, expires_at = excluded.expires_at`;
    await sql`delete from rate_limit_buckets where key like 'tool:recruiter:%'`;
  });
}

const cleanup = (login: string) => withAppDatabase((sql) => sql`delete from analysis_cache where kind = 'recruiter' and subject_key = ${login.toLowerCase()}`);

test.describe('Recruiter-Ready Score', () => {
  test('shows a visitor the score and the checklist, without any secret panel', async ({ page }) => {
    const login = `e2e-rr-${randomBytes(4).toString('hex')}`;
    await cacheReport(login, { skills: [] }, false);
    try {
      await page.goto(`/tools/recruiter?login=${login}`);
      const result = page.getByTestId('recruiter-result');
      await expect(result).toBeVisible();
      await expect(result.getByRole('meter', { name: 'Recruiter-Ready score' })).toHaveAttribute('aria-valuenow', '64');
      await expect(result.getByText('1 of 2 pinned repositories have a README over 600 characters.')).toBeVisible();
      await expect(result.getByText('Not checked this time: Skills you listed.')).toBeVisible();
      await result.getByText('How to fix').first().click();
      await expect(result.getByText(/Create a repository named exactly like the username/)).toBeVisible();

      await expect(page.getByTestId('secret-panel')).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await cleanup(login);
    }
  });

  test("shows the owner their own secret scan, and only to them", async ({ page, context, browser, baseURL }) => {
    const member = await signInTestMember(context, baseURL ?? '');
    const githubId = 700_000_000 + Math.floor(Math.random() * 1_000_000);
    await withAppDatabase(async (sql) => {
      await sql`insert into users (id) values (${member.userId}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone) values (${member.userId}, 'UTC') on conflict (user_id) do nothing`;
      await sql`insert into github_identities (user_id, github_id, login) values (${member.userId}, ${githubId}, ${member.login})
                on conflict (user_id) do update set login = excluded.login`;
      await sql`insert into recruiter_reports (user_id, subject_github_id, score, rules, secret_findings, files_scanned, computed_at)
                values (${member.userId}, ${githubId}, 64, '[]'::jsonb,
                        ${sql.json([{ ruleId: 'github-pat', repo: `${member.login}/app`, path: 'src/client.ts', line: 4 }])}, 12, now())`;
    });
    await cacheReport(member.login, { skills: [], scanFor: member.userId }, true);
    await cacheReport(member.login, { skills: [] }, false);
    const visitorContext = await browser.newContext({ baseURL: baseURL ?? '' });
    const visitor = await visitorContext.newPage();
    try {
      await page.goto(`/tools/recruiter?login=${member.login}`);
      const panel = page.getByTestId('secret-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText(`github pat in ${member.login}/app/src/client.ts, line 4`)).toBeVisible();
      await expect(panel.getByText(/Deleting the file does not remove the key from git history/)).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Also scan my repositories/ })).toBeChecked();
      await expectNoSeriousA11yViolations(page);

      // Someone else looking at the same account sees the checklist and nothing about secrets.
      await visitor.goto(`/tools/recruiter?login=${member.login}`);
      await expect(visitor.getByTestId('recruiter-result')).toBeVisible();
      await expect(visitor.getByTestId('secret-panel')).toHaveCount(0);
      await expect(visitor.getByText('src/client.ts')).toHaveCount(0);
    } finally {
      await visitorContext.close();
      await cleanup(member.login);
      await member.cleanup();
    }
  });
});
