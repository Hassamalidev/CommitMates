import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { cacheCard } from './helpers/dev-card';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember, type TestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };

/** Who may open the page at each visibility (CLAUDE.md §8 F1 "Privacy", P5-T10). */
const EXPECTED = {
  university: { sameUniversity: 200, sameCountry: 404, otherCountry: 404, visitor: 404 },
  country: { sameUniversity: 200, sameCountry: 200, otherCountry: 404, visitor: 404 },
  public: { sameUniversity: 200, sameCountry: 200, otherCountry: 200, visitor: 200 },
  hidden: { sameUniversity: 404, sameCountry: 404, otherCountry: 404, visitor: 404 },
} as const;

test.describe('member profile pages (P5-T10)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('each visibility level decides who sees the page, and the page shows earned badges', async ({ browser, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const home = await seedUniversity(`Profile University ${suffix}`, `profile-university-${suffix}`);
    const neighbour = await seedUniversity(`Profile Neighbour ${suffix}`, `profile-neighbour-${suffix}`);
    const [abroadRow] = await withAppDatabase(
      (sql) => sql<{ id: string }[]>`
        insert into universities (name, slug, country, country_code, web_pages, source, checksum)
        values (${`Profile Abroad ${suffix}`}, ${`profile-abroad-${suffix}`}, 'Elsewhere', 'XE', '{}', 'admin', 'e2e') returning id`,
    );
    const abroad = abroadRow!.id;
    const contexts: BrowserContext[] = [];
    const members: TestMember[] = [];
    const signIn = async (universityId: string) => {
      const context = await browser.newContext({ baseURL: baseURL ?? '' });
      contexts.push(context);
      const member = await signInTestMember(context, baseURL ?? '');
      members.push(member);
      await prepareMember(member, { universityId, verifiedDaysAgo: 1, onboarded: true });
      return { context, member };
    };
    try {
      const owner = await signIn(home);
      const viewers = {
        sameUniversity: await signIn(home),
        sameCountry: await signIn(neighbour),
        otherCountry: await signIn(abroad),
        visitor: { context: await browser.newContext({ baseURL: baseURL ?? '' }) },
      };
      contexts.push(viewers.visitor.context);
      const [identity] = await withAppDatabase((sql) => sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${owner.member.userId}`);
      await cacheCard(owner.member.login, Number(identity!.github_id));
      await withAppDatabase(
        (sql) => sql`insert into oss_member_contribs (user_id, repo_full_name, merged_prs, refreshed_at) values (${owner.member.userId}, 'vercel/next.js', 2, now())`,
      );

      for (const [visibility, expected] of Object.entries(EXPECTED)) {
        await withAppDatabase((sql) => sql`update profiles set visibility = ${visibility} where user_id = ${owner.member.userId}`);
        for (const [who, status] of Object.entries(expected)) {
          const page = await viewers[who as keyof typeof viewers].context.newPage();
          const response = await page.goto(`/u/${owner.member.login}`);
          expect(response?.status(), `${who} at ${visibility}`).toBe(status);
          await page.close();
        }
      }

      // A classmate sees the open-source badge earned from merged pull requests.
      await withAppDatabase((sql) => sql`update profiles set visibility = 'university' where user_id = ${owner.member.userId}`);
      const page = await viewers.sameUniversity.context.newPage();
      await page.goto(`/u/${owner.member.login}`);
      const badges = page.getByTestId('profile-badges');
      await expect(badges.getByText('Open source')).toBeVisible(ACTION_TIMEOUT);
      await expect(badges.getByText('2 merged pull requests to 1 project')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      for (const member of members) await member.cleanup();
      for (const context of contexts) await context.close();
      await withAppDatabase((sql) => sql`delete from universities where id in (${home}, ${neighbour}, ${abroad})`);
    }
  });
});
