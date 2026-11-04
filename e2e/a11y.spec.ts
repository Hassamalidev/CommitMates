import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { expectNoSeriousA11yViolations } from './helpers/axe';
import { grantAdmin, withAppDatabase } from './helpers/db';
import { cacheCard, uniqueLogin } from './helpers/dev-card';
import { prepareMember, seedUniversity } from './helpers/members';
import { signInTestMember, type TestMember } from './helpers/session';

/**
 * Accessibility audit (CLAUDE.md §9.10, P7-T03). Every page of the app is opened, in the dark and
 * the light theme, and checked with axe; each has exactly one H1, named data tables and labelled
 * companions; and the keyboard can walk through it with a visible focus indicator at every stop.
 * The route inventory fails when a page is added without being listed here.
 */

const APP_DIR = path.resolve(import.meta.dirname, '../apps/web/src/app');
const THEMES = ['dark', 'light'] as const;
/** Tab presses per page in the keyboard walkthrough; enough to cross the header into the content. */
const TAB_STOPS = 40;
/** The focus ring of §9.10 is 2px. */
const MIN_OUTLINE_PX = 2;

/** Every page route of the app, from the file system: route groups dropped, API routes left out. */
function appRoutes(dir = APP_DIR, prefix = ''): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') routes.push(prefix === '' ? '/' : prefix);
    if (!entry.isDirectory() || entry.name === 'api' || entry.name.startsWith('_')) continue;
    const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
    routes.push(...appRoutes(path.join(dir, entry.name), prefix + segment));
  }
  return routes;
}

/** What the member pages need to show something: a university, a conversation, an event, an idea, a project. */
type Seed = {
  member: TestMember;
  other: TestMember;
  slug: string;
  threadId: string;
  eventId: string;
  ideaId: string;
  legacyId: string;
  cardLogin: string;
  cleanup: () => Promise<void>;
};

async function seedMember(browser: Browser, page: Page, baseURL: string): Promise<Seed> {
  const suffix = randomBytes(4).toString('hex');
  const slug = `audit-university-${suffix}`;
  const universityId = await seedUniversity(`Audit University ${suffix}`, slug);
  const member = await signInTestMember(page.context(), baseURL);
  await prepareMember(member, { universityId, verifiedDaysAgo: 30, onboarded: true });
  await grantAdmin(member.userId);
  const otherContext = await browser.newContext();
  const other = await signInTestMember(otherContext, baseURL);
  await otherContext.close();
  await prepareMember(other, { universityId, verifiedDaysAgo: 30, onboarded: true });
  const cardLogin = uniqueLogin();
  await cacheCard(cardLogin, Number.parseInt(suffix.slice(0, 5), 16));

  const ids = await withAppDatabase(async (sql) => {
    // Enough verified classmates to open every campus feature, so the audit sees the open pages, not only Unlock cards.
    const [needed] = await sql<{ members: number }[]>`
      select max(coalesce(override_value, computed_value, default_value)::int) as members
      from settings where key like 'unlock.%.minMembers'`;
    const classmates = await sql<{ id: string }[]>`
      insert into auth.users (id) select gen_random_uuid() from generate_series(1, ${needed?.members ?? 0}) returning id`;
    const classmateIds = classmates.map((row) => row.id);
    await sql`insert into users (id) select unnest(${classmateIds}::uuid[]) on conflict (id) do nothing`;
    await sql`insert into profiles (user_id, timezone, university_id, verified_at, verified_via, onboarded_at)
              select unnest(${classmateIds}::uuid[]), 'UTC', ${universityId}, now() - interval '30 days', 'email', now()
              on conflict (user_id) do update set university_id = excluded.university_id, verified_at = excluded.verified_at,
                verified_via = excluded.verified_via, onboarded_at = excluded.onboarded_at`;
    // Some of them graduated, so Alumni Quick Asks opens too.
    await sql`update profiles set role = 'alumni'
              where user_id = any(${classmateIds}::uuid[])
                and user_id in (select unnest(${classmateIds}::uuid[]) limit (
                  select coalesce(override_value, computed_value, default_value)::int from settings where key = 'unlock.alumni.minAlumni'))`;
    const [thread] = await sql<{ id: string }[]>`insert into threads (kind) values ('direct') returning id`;
    if (!thread) throw new Error('thread insert returned no row');
    await sql`insert into thread_members (thread_id, user_id) values (${thread.id}, ${member.userId}), (${thread.id}, ${other.userId})`;
    await sql`insert into messages (thread_id, author_user_id, kind, body) values (${thread.id}, ${other.userId}, 'user', 'Want to pair on the Graveyard project this week?')`;
    const [event] = await sql<{ id: string }[]>`
      insert into events (creator_user_id, title, description, visibility, university_id, starts_at, ends_at, team_size)
      values (${member.userId}, 'Audit hackathon', 'A weekend of building together.', 'university', ${universityId},
              now() + interval '7 days', now() + interval '9 days', 4)
      returning id`;
    const [idea] = await sql<{ id: string }[]>`
      insert into fyp_ideas (university_id, author_user_id, title, description, keyphrases)
      values (${universityId}, ${member.userId}, 'Timetable planner for shared labs',
              'A planner that books shared university labs and avoids clashes between courses.', array['timetable planner', 'shared labs'])
      returning id`;
    const [identity] = await sql<{ github_id: string }[]>`select github_id from github_identities where user_id = ${member.userId}`;
    if (!event || !idea || !identity) throw new Error('seed insert returned no row');
    const repoId = 700_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, primary_language, fetched_at)
              values (${repoId}, ${identity.github_id}, ${`${member.login}/lab-planner`}, 'lab-planner', 'Books shared labs.', array['scheduling'], 'TypeScript', now())`;
    const [entry] = await sql<{ id: string }[]>`
      insert into legacy_entries (university_id, owner_user_id, repo_github_id, source, tags, blurb, accepts_questions)
      values (${universityId}, ${member.userId}, ${repoId}, 'showcase', array['scheduling'], 'Our final-year planner.', true)
      returning id`;
    if (!entry) throw new Error('legacy entry insert returned no row');
    return { threadId: thread.id, eventId: event.id, ideaId: idea.id, legacyId: entry.id, repoId, classmateIds };
  });

  return {
    member,
    other,
    slug,
    cardLogin,
    ...ids,
    cleanup: async () => {
      await withAppDatabase(async (sql) => {
        await sql`delete from threads where id = ${ids.threadId}`;
        await sql`delete from gh_repos where github_id = ${ids.repoId}`;
        await sql`delete from analysis_cache where subject_key = ${cardLogin}`;
        await sql`delete from auth.users where id = any(${ids.classmateIds}::uuid[])`;
      });
      await member.cleanup();
      await other.cleanup();
      await withAppDatabase((sql) => sql`delete from universities where id = ${universityId}`);
    },
  };
}

/** Concrete addresses for each route, with what the dynamic segments need. */
type Pages = Record<string, (seed: Seed) => string>;

const PUBLIC_PAGES: Pages = {
  '/': () => '/',
  '/privacy': () => '/privacy',
  '/terms': () => '/terms',
  '/attribution': () => '/attribution',
  '/optout': () => '/optout',
  '/health': () => '/health',
};

const TOOL_PAGES: Pages = {
  '/tools/dev-card': (seed) => `/tools/dev-card?login=${seed.cardLogin}`,
  '/tools/compat': () => '/tools/compat',
  '/tools/recruiter': () => '/tools/recruiter',
  '/tools/fairness': () => '/tools/fairness',
  '/tools/gap': () => '/tools/gap',
  '/tools/graveyard': () => '/tools/graveyard',
  '/tools/oss': () => '/tools/oss',
  '/tools/fyp-check': () => '/tools/fyp-check',
};

const MEMBER_PAGES: Pages = {
  '/home': () => '/home',
  '/discover': () => '/discover',
  '/inbox': () => '/inbox',
  '/inbox/[threadId]': (seed) => `/inbox/${seed.threadId}`,
  '/streaks': () => '/streaks',
  '/reviews': () => '/reviews',
  '/swaps': () => '/swaps',
  '/legacy': () => '/legacy',
  '/legacy/[id]': (seed) => `/legacy/${seed.legacyId}`,
  '/uni/[slug]': (seed) => `/uni/${seed.slug}`,
  '/leaderboards': () => '/leaderboards',
  '/alumni': () => '/alumni',
  '/events': () => '/events',
  '/events/[id]': (seed) => `/events/${seed.eventId}`,
  '/fyp': () => '/fyp',
  '/fyp/ideas/[id]': (seed) => `/fyp/ideas/${seed.ideaId}`,
  '/u/[login]': (seed) => `/u/${seed.member.login}`,
  '/notifications': () => '/notifications',
  '/feedback': () => '/feedback',
  '/settings/privacy': () => '/settings/privacy',
  '/settings/notifications': () => '/settings/notifications',
  '/settings/projects': () => '/settings/projects',
};

const ADMIN_PAGES: Pages = {
  '/admin/health': () => '/admin/health',
  '/admin/metrics': () => '/admin/metrics',
  '/admin/jobs': () => '/admin/jobs',
  '/admin/settings': () => '/admin/settings',
  '/admin/settings/[key]': () => '/admin/settings/jobs.tickBudgetMs',
  '/admin/universities': () => '/admin/universities',
  '/admin/moderation': () => '/admin/moderation',
  '/admin/roles': () => '/admin/roles',
  '/admin/audit': () => '/admin/audit',
  '/admin/crawler': () => '/admin/crawler',
};

/** Opened by a member who has not verified yet, since verified members move on to /home. */
const ONBOARDING_PAGE = '/onboarding';
/** Headings of the not-found and error pages (apps/web/src/copy/errors.ts). */
const ERROR_PAGE_TITLES = /^(We could not find that page|Something broke on our side)$/;
/** Presses on one element in a row that mean focus is held there. */
const TRAP_PRESSES = 5;

/** Tables are named and have header cells; companions are hidden or labelled with their state. */
async function expectLabelledStructures(page: Page, url: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    for (const table of document.querySelectorAll('table')) {
      const names = [table.caption?.textContent.trim() ?? '', table.getAttribute('aria-label') ?? '', table.getAttribute('aria-labelledby') ?? ''];
      const named = names.some((name) => name !== '');
      if (!named) found.push(`table without a caption: ${table.outerHTML.slice(0, 80)}`);
      if (table.querySelectorAll('th').length === 0) found.push(`table without header cells: ${table.outerHTML.slice(0, 80)}`);
    }
    for (const companion of document.querySelectorAll('svg[data-state]')) {
      const hidden = companion.getAttribute('aria-hidden') === 'true' || companion.closest('[aria-hidden="true"]') !== null;
      const labelled = companion.getAttribute('role') === 'img' && (companion.getAttribute('aria-label') ?? '').trim() !== '';
      if (!hidden && !labelled) found.push(`companion neither hidden nor labelled: ${companion.outerHTML.slice(0, 80)}`);
    }
    return found;
  });
  expect(problems, `unlabelled structures on ${url}`).toEqual([]);
}

async function auditPage(page: Page, url: string): Promise<void> {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    const response = await page.goto(url);
    expect(response?.status(), `status of ${url}`).toBe(200);
    // A redirect (to sign-in or onboarding) would audit the wrong page.
    expect(new URL(page.url()).pathname, `${url} was redirected`).toBe(new URL(url, page.url()).pathname);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('h1'), `one H1 on ${url}`).toHaveCount(1);
    await expectLabelledStructures(page, url);
    await expectNoSeriousA11yViolations(page, `${url} (${theme})`);
    // A section that fails while streaming swaps the page for the error page, which is accessible too.
    await expect(page.getByRole('heading', { level: 1, name: ERROR_PAGE_TITLES }), `${url} rendered an error page`).toHaveCount(0);
  }
}

type FocusStop = { label: string; visible: boolean; ring: boolean; inBody: boolean };

/** Tabs through the page and describes every stop: visible, with a 2px outline or a ring, and real. */
async function walkKeyboard(page: Page, url: string): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url);
  const stops: FocusStop[] = [];
  for (let press = 0; press < TAB_STOPS; press++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((minOutline) => {
      const element = document.activeElement;
      if (!element || element === document.body) return { label: 'body', visible: false, ring: false, inBody: false };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= minOutline;
      const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      // A date or time input's calendar button lives in the browser's closed shadow root: the input no
      // longer matches :focus, and the browser draws that button's ring itself (ADR-012).
      const browserPart = element instanceof HTMLInputElement && !element.matches(':focus');
      const label = `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 40)}"`;
      return { label, visible: rect.width > 0 && rect.height > 0 && element.checkVisibility(), ring: outline || shadow || browserPart, inBody: true };
    }, MIN_OUTLINE_PX);
    // Past the last control, focus leaves the document for the browser's own UI: the walk is complete.
    if (!stop.inBody) {
      expect(stops.length, `${url}: the keyboard reaches nothing`).toBeGreaterThan(0);
      break;
    }
    stops.push(stop);
  }
  const invisible = stops.filter((stop) => !stop.visible).map((stop) => stop.label);
  const ringless = stops.filter((stop) => !stop.ring).map((stop) => stop.label);
  expect(invisible, `${url}: focus on elements that cannot be seen`).toEqual([]);
  expect(ringless, `${url}: focus without a visible indicator`).toEqual([]);
  // The first stop is the skip link (§9.10 landmarks), so keyboard users can jump to the content.
  expect(stops[0]?.label ?? '', `${url}: first Tab stop`).toMatch(/^a "Skip to/);
  // A trap would hold focus on one element press after press.
  const last = stops.slice(-TRAP_PRESSES);
  const trapped = last.length === TRAP_PRESSES && last.every((stop) => stop.label === last[0]?.label);
  expect(trapped, `${url}: focus is trapped`).toBe(false);
}

test.describe('accessibility audit (P7-T03)', () => {
  test.describe.configure({ timeout: 600_000 });

  test('the Dev Card charts read as data to screen readers', async ({ page }) => {
    const login = uniqueLogin();
    await cacheCard(login, Number.parseInt(randomBytes(2).toString('hex'), 16));
    try {
      await page.goto(`/tools/dev-card?login=${login}`);
      const card = page.getByTestId('dev-card');
      await expect(card).toBeVisible();
      // The language bar and the heatmap each carry a captioned table; the 90-day grid is also a slider.
      await expect(card.getByRole('table')).toHaveCount(2);
      await expect(card.getByRole('slider')).toHaveCount(1);
      await expect(card.getByRole('img', { name: `The companion of @${login}` })).toBeVisible();
    } finally {
      await withAppDatabase((sql) => sql`delete from analysis_cache where subject_key = ${login}`);
    }
  });

  test('every page of the app is in the audit', () => {
    const listed = [PUBLIC_PAGES, TOOL_PAGES, MEMBER_PAGES, ADMIN_PAGES].flatMap((pages) => Object.keys(pages)).concat(ONBOARDING_PAGE);
    expect([...listed].sort()).toEqual(appRoutes().sort());
  });

  for (const [group, pages] of Object.entries({ public: PUBLIC_PAGES, tools: TOOL_PAGES, members: MEMBER_PAGES, admin: ADMIN_PAGES })) {
    test(`${group} pages pass axe in both themes and walk by keyboard`, async ({ browser, page, baseURL }, testInfo) => {
      const seed = await seedMember(browser, page, baseURL ?? '');
      try {
        for (const address of Object.values(pages)) {
          const url = address(seed);
          await auditPage(page, url);
          // The walkthrough is about focus, not layout, so one viewport is enough.
          if (testInfo.project.name === 'desktop') await walkKeyboard(page, url);
        }
      } finally {
        await seed.cleanup();
      }
    });
  }

  test('onboarding passes axe in both themes and walks by keyboard', async ({ page, baseURL }, testInfo) => {
    const member = await signInTestMember(page.context(), baseURL ?? '');
    await prepareMember(member, {});
    try {
      await auditPage(page, ONBOARDING_PAGE);
      if (testInfo.project.name === 'desktop') await walkKeyboard(page, ONBOARDING_PAGE);
    } finally {
      await member.cleanup();
    }
  });
});
