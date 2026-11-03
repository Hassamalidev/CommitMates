import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { withAppDatabase } from './helpers/db';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember } from './helpers/session';

const ACTION_TIMEOUT = { timeout: 15_000 };
/** Verified members `unlock.matching.minMembers` asks for by default. */
const UNLOCK_MEMBERS = 10;

type Candidate = { id: string; login: string; name: string };

/** Verified classmates with a GitHub identity and a skill vector, created straight in the database. */
async function seedClassmates(universityId: string, count: number, suffix: string): Promise<Candidate[]> {
  return withAppDatabase(async (sql) => {
    const people: Candidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const [auth] = await sql<{ id: string }[]>`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      if (!auth) throw new Error('auth.users insert returned no row');
      const login = `e2e-mate-${suffix}-${index}`;
      const name = `Classmate ${suffix} ${index}`;
      await sql`insert into users (id) values (${auth.id}) on conflict (id) do nothing`;
      await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at, grad_year)
                values (${auth.id}, 'UTC', ${universityId}, now(), 'email', now(), ${2026 + (index % 2)})`;
      await sql`insert into github_identities (user_id, github_id, login, name)
                values (${auth.id}, ${700_000_000 + Number.parseInt(randomBytes(3).toString('hex'), 16)}, ${login}, ${name})`;
      const tags = index === 0 ? ['docker', 'react'] : ['react'];
      const vector = Object.fromEntries(tags.map((tag) => [tag, 1]));
      await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                values (${auth.id}, ${sql.json(vector)}, ${sql.json(vector)}, ${tags}, '{}', now())`;
      people.push({ id: auth.id, login, name });
    }
    return people;
  });
}

async function suggest(userId: string, candidate: Candidate, mode: string, score: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await withAppDatabase(
    (sql) => sql`
      insert into match_suggestions (user_id, candidate_user_id, mode, score, components, explanation_keys, shown_on)
      values (${userId}, ${candidate.id}, ${mode}, ${score}, '{}',
              ${sql.json({ sharedTags: ['react'], coverage: ['docker'], sharedInterests: 2 })}, ${day})`,
  );
}

test.describe('Discover (P4-T04)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('before matching opens: the Unlock card, an invite link and the view-only list', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Locked University ${suffix}`, `locked-university-${suffix}`);
    const member = await signInTestMember(context, baseURL ?? '');
    await prepareMember(member, { universityId, verifiedDaysAgo: 1, onboarded: true });
    try {
      await page.goto('/home');
      await page.getByRole('link', { name: 'Open Discover' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('progressbar', { name: 'Find a partner' })).toHaveAttribute('aria-valuemax', String(UNLOCK_MEMBERS));
      await expect(page.getByText(`1 / ${UNLOCK_MEMBERS} verified members`)).toBeVisible();
      await expect(page.getByLabel('Your invite link')).toHaveValue(/\?ref=locked-university-/);
      await expect(page.getByRole('heading', { name: 'Developers like you on GitHub' })).toBeVisible();
      await expect(page.getByText('Once your public repositories show a main language')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    } finally {
      await member.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${universityId}`);
    }
  });

  test('before matching opens, developers like you come from the country index, as view-only links (P6-T08)', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    // A language of this test only, so other specs' index rows never show up here.
    const language = `E2E-${suffix}`;
    const universityId = await seedUniversity(`Index University ${suffix}`, `index-university-${suffix}`);
    const member = await signInTestMember(context, baseURL ?? '');
    const base = Number.parseInt(suffix, 16) * 100;
    const logins = Array.from({ length: 10 }, (_, index) => `indexed-${suffix}-${index}`);
    try {
      await prepareMember(member, { universityId, verifiedDaysAgo: 1, onboarded: true });
      await withAppDatabase(async (sql) => {
        const [identity] = await sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${member.userId}`;
        await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, primary_language, is_fork, fetched_at)
                  values (${base}, ${identity!.github_id}, ${`${member.login}/app`}, 'app', ${language}, false, now())`;
        for (const [index, login] of logins.entries()) {
          await sql`insert into gh_users (github_id, login, in_country_index, index_country_code, is_member, fetched_at)
                    values (${base + 1 + index}, ${login}, true, 'TL', false, now())`;
          await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, primary_language, is_fork, fetched_at)
                    values (${base + 100 + index}, ${base + 1 + index}, ${`${login}/lib`}, 'lib', ${language}, false, now())`;
        }
      });
      await page.goto('/discover');
      const list = page.getByRole('heading', { name: 'Developers like you on GitHub' }).locator('..');
      await expect(page.getByText('From our index of public developers in your country.')).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('link', { name: `@${logins[0]} on GitHub` })).toHaveAttribute('href', `https://github.com/${logins[0]}`);
      // View only: nobody in the list can be messaged from here.
      await expect(list.getByRole('button')).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
    } finally {
      await member.cleanup();
      await withAppDatabase(async (sql) => {
        await sql`delete from gh_repos where primary_language = ${language}`;
        await sql`delete from gh_users where login like ${`indexed-${suffix}-%`}`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });

  test('a member works through the deck with the keyboard, likes, and sends a request', async ({ page, context, baseURL }) => {
    const suffix = randomBytes(4).toString('hex');
    const universityId = await seedUniversity(`Deck University ${suffix}`, `deck-university-${suffix}`);
    const member = await signInTestMember(context, baseURL ?? '');
    await prepareMember(member, { universityId, verifiedDaysAgo: 1, onboarded: true });
    try {
      const mates = await seedClassmates(universityId, UNLOCK_MEMBERS - 1, suffix);
      const [first, second, third] = mates;
      if (!first || !second || !third) throw new Error('expected classmates');
      await withAppDatabase(async (sql) => {
        // A skill vector puts the member in Study mode by default.
        await sql`insert into skill_vectors (user_id, base, vector, top_tags, interests, computed_at)
                  values (${member.userId}, '{"react":1}', '{"react":1}', '{react}', '{}', now())`;
        await sql`insert into persona_snapshots (user_id, metrics, labels, companion, computed_at)
                  values (${first.id}, '{}', '{nightOwl}', ${sql.json({ seed: 42, speciesKey: 'docker', paletteHex: '#2496ed', stage: 2, traits: [] })}, now())`;
      });
      await suggest(member.userId, first, 'study', 0.9);
      await suggest(member.userId, second, 'study', 0.5);
      await suggest(member.userId, third, 'teammate', 0.7);

      await page.goto('/discover');
      const firstCard = page.getByRole('article', { name: first.name });
      await expect(firstCard).toBeVisible(ACTION_TIMEOUT);
      await expect(firstCard.getByText('Night Owl')).toBeVisible();
      await expect(firstCard.getByText('You both build with react.')).toBeVisible();
      await expect(firstCard.getByText("They know docker, which you haven't used yet.")).toBeVisible();
      await expect(page.getByText('1 of 2 today')).toBeVisible();
      await expectNoSeriousA11yViolations(page);

      // ← skips, → likes.
      await page.locator('body').press('ArrowLeft');
      await expect(page.getByRole('status').filter({ hasText: `Skipped @${first.login}.` })).toBeVisible(ACTION_TIMEOUT);
      await expect(page.getByRole('article', { name: second.name })).toBeVisible(ACTION_TIMEOUT);
      await page.locator('body').press('ArrowRight');
      await expect(page.getByText("You've seen everyone for today")).toBeVisible(ACTION_TIMEOUT);
      const likedRequest = page.getByRole('button', { name: `Request chat: ${second.name}` });
      await expect(likedRequest).toBeVisible();

      // A request from the liked list: the rules answer inline, then it is sent.
      await likedRequest.click();
      const dialog = page.getByRole('dialog', { name: `Message @${second.login}` });
      await expect(dialog).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await dialog.getByLabel('First message').fill('Hi there!');
      // The browser's own length check would stop the form; submit past it to see the server's rule.
      await dialog.locator('form').evaluate((form) => {
        (form as HTMLFormElement).noValidate = true;
      });
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(dialog.getByText('at least 40 characters')).toBeVisible(ACTION_TIMEOUT);
      await dialog.getByLabel('First message').fill('Hi! I saw you build with React. Want to pair on a small project this term?');
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText(`Request sent to @${second.login}.`)).toBeVisible(ACTION_TIMEOUT);
      await expect(dialog).toHaveCount(0);
      const [request] = await withAppDatabase(
        (sql) => sql`select context_kind, status from message_requests where from_user = ${member.userId} and to_user = ${second.id}`,
      );
      expect(request).toMatchObject({ context_kind: 'discover', status: 'pending' });

      // Another mode has its own deck, and filters narrow it.
      await page.getByRole('link', { name: 'Teammate' }).click();
      await expect(page.getByRole('article', { name: third.name })).toBeVisible(ACTION_TIMEOUT);
      await page.getByLabel('Graduating from').fill('2030');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page.getByText('Nobody here matches these filters')).toBeVisible(ACTION_TIMEOUT);
      await page.getByRole('link', { name: 'Clear filters' }).first().click();
      await expect(page.getByRole('article', { name: third.name })).toBeVisible(ACTION_TIMEOUT);
    } finally {
      await member.cleanup();
      await withAppDatabase(async (sql) => {
        // Everyone at the test university, including classmates of a seed that stopped halfway.
        await sql`delete from auth.users where id in (select user_id from profiles where university_id = ${universityId})`;
        await sql`delete from universities where id = ${universityId}`;
      });
    }
  });
});
