import {
  ForbiddenError,
  addToCountryIndex,
  countryIndexCounts,
  crawlSeeds,
  crawlerStatus,
  extendCursors,
  getSetting,
  indexedLogin,
  nextCrawlCursor,
  optOutOfIndex,
  optedOutLogins,
  pruneCountryIndex,
  removeFromCountryIndex,
  splitCrawlCursor,
  updateCrawlCursor,
  upsertGhRepos,
  type CrawlCursor,
  type CrawlerStatus,
} from '@commitmates/db';
import { GitHubNotFoundError, SERVER_IDENTITY, githubFor, listUserRepos, searchUsersPage, type GitHubClient, type Repository } from '@commitmates/github';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

import { utcDay } from '../notifications/email';
import { loginSchema } from '../persona/schemas';
import type { Member } from '../profiles/schemas';
import { hasRole } from '../profiles/service';

const MS_PER_DAY = 24 * 60 * 60 * 1000; // allowed-literal: unit conversion
/** GitHub's largest search page. */
const SEARCH_PAGE_SIZE = 100;
/** Time kept in hand before the deadline; the crawl continues in a follow-up. */
const DEADLINE_MARGIN_MS = 4000;
/** Characters of an ISO timestamp that make up `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;
/** Characters of an ISO timestamp that make up `YYYY-MM`, the month in a repository fetch's key. */
const ISO_MONTH_LENGTH = 7;
/** A range too large for search is split into this many parts (§8 F18 step 2: "in half"). */
const SPLIT_PARTS = 2;

/** The search for one cursor (§8 F18 "Crawl" step 1); the seed is quoted, as GitHub's location qualifier wants. */
export const cursorQuery = (cursor: Pick<CrawlCursor, 'seed' | 'createdFrom' | 'createdTo'>): string =>
  `location:"${cursor.seed.replace(/"/g, '')}" created:${cursor.createdFrom}..${cursor.createdTo}`;

/** The last day of the first half of a date range, or null for a single day, which cannot be split. */
export function middleDay(from: string, to: string): string | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (end <= start) return null;
  return new Date(start + Math.floor((end - start) / MS_PER_DAY / SPLIT_PARTS) * MS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);
}

type Limits = { maxUsers: number; maxRepos: number; pruneTarget: number };

async function limits(): Promise<Limits> {
  const [maxUsers, maxRepos, pruneTarget] = await Promise.all([getSetting('crawler.maxUsers'), getSetting('crawler.maxRepos'), getSetting('crawler.pruneTargetPct')]);
  return { maxUsers, maxRepos, pruneTarget };
}

/**
 * The storage guard (§8 F18 step 5): at either limit the index is pruned back to `crawler.pruneTargetPct`
 * of both, and the caller stops adding for this run. Returns whether there is room.
 */
export async function guardStorage(): Promise<boolean> {
  const [counts, limit] = await Promise.all([countryIndexCounts(), limits()]);
  if (counts.users < limit.maxUsers && counts.repos < limit.maxRepos) return true;
  await pruneCountryIndex({ users: Math.floor(limit.maxUsers * limit.pruneTarget), repos: Math.floor(limit.maxRepos * limit.pruneTarget) });
  return false;
}

export type CrawlStep = 'split' | 'page' | 'done' | 'full' | 'idle';

/**
 * One step of the crawl (§8 F18 "Crawl"): the next cursor's next page. A first page whose total is
 * above `crawler.searchCap` splits the cursor's date range in half instead; a single day that is
 * still too large is crawled up to the cap. New accounts are added to the cursor's country index,
 * never an opted-out login, and each gets a low-priority repository fetch.
 */
export async function crawlStep(client: GitHubClient, now: Date, deadline: number): Promise<CrawlStep> {
  const [searchCap, refreshDays, earliest, minCityMembers] = await Promise.all([
    getSetting('crawler.searchCap'),
    getSetting('crawler.refreshDays'),
    getSetting('crawler.earliestAccountDate'),
    getSetting('crawler.minCitySeedMembers'),
  ]);
  let cursor = await nextCrawlCursor(new Date(now.getTime() - refreshDays * MS_PER_DAY));
  if (!cursor) {
    // Nothing waiting: cover new seeds, and accounts created since the last pass.
    if ((await extendCursors(await crawlSeeds(minCityMembers), earliest, utcDay(now))) === 0) return 'idle';
    cursor = await nextCrawlCursor(new Date(now.getTime() - refreshDays * MS_PER_DAY));
    if (!cursor) return 'idle';
  }
  if (!(await guardStorage())) return 'full';

  const page = cursor.page + 1;
  const result = await searchUsersPage(client, cursorQuery(cursor), { perPage: SEARCH_PAGE_SIZE, page, deadline });
  if (page === 1 && result.totalCount > searchCap) {
    const middle = middleDay(cursor.createdFrom, cursor.createdTo);
    if (middle !== null) {
      await splitCrawlCursor(cursor, result.totalCount, middle);
      return 'split';
    }
  }
  const optedOut = await optedOutLogins(result.users.map((user) => user.login));
  const fresh = await addToCountryIndex(
    result.users.filter((user) => !optedOut.has(user.login.toLowerCase())),
    cursor.countryCode,
    now,
  );
  for (const githubId of fresh) {
    await enqueue('crawl_repos', { githubId }, { idempotencyKey: `crawl-repos:${githubId}:${utcDay(now).slice(0, ISO_MONTH_LENGTH)}`, priority: PRIORITY.CRAWL });
  }
  const reachable = Math.min(result.totalCount, searchCap);
  const finished = page * SEARCH_PAGE_SIZE >= reachable || result.users.length < SEARCH_PAGE_SIZE;
  await updateCrawlCursor(cursor.id, finished ? { page, totalCount: result.totalCount, status: 'done', crawledAt: now } : { page, totalCount: result.totalCount, status: 'running' });
  return finished ? 'done' : 'page';
}

const emptyPayload = z.object({});

/** `crawl_country` (§5.4, priority CRAWL): steps through the crawl within the run's budget; the schedule brings it back. */
export const crawlCountryJob: JobHandler<z.infer<typeof emptyPayload>> = {
  type: 'crawl_country',
  schema: emptyPayload,
  priority: PRIORITY.CRAWL,
  async run(_payload, ctx) {
    const client = githubFor(SERVER_IDENTITY, { now: ctx.now });
    const steps: CrawlStep[] = [];
    while (Date.now() < ctx.deadline - DEADLINE_MARGIN_MS) {
      const step = await crawlStep(client, ctx.now(), ctx.deadline);
      steps.push(step);
      if (step === 'idle' || step === 'full') break;
    }
    return { kind: 'done', resultRef: { steps: steps.length, last: steps.at(-1) ?? null } };
  },
};

/** A crawled repository as stored: metadata only, no README, no expiry (§8 F18 step 4, §5.12 class E). */
function repoRow(repo: Repository, now: Date) {
  return {
    githubId: repo.githubId,
    ownerGithubId: repo.ownerGithubId ?? 0,
    fullName: repo.fullName,
    name: repo.name,
    description: repo.description,
    homepage: repo.homepage,
    topics: repo.topics,
    primaryLanguage: repo.language,
    languages: {},
    stars: repo.stars,
    forks: repo.forks,
    openIssues: repo.openIssues,
    licenseSpdx: repo.licenseSpdx,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    defaultBranch: repo.defaultBranch,
    sizeKb: repo.sizeKb,
    ghCreatedAt: repo.createdAt ? new Date(repo.createdAt) : now,
    pushedAt: repo.pushedAt ? new Date(repo.pushedAt) : null,
    fetchedAt: now,
    expiresAt: null,
  };
}

const reposPayloadSchema = z.object({ githubId: z.number().int().positive() });

/**
 * `crawl_repos`: an indexed account's own non-fork repositories, up to `crawler.reposPerUser`, as
 * metadata. An account GitHub no longer has leaves the index with its repositories.
 */
export const crawlReposJob: JobHandler<z.infer<typeof reposPayloadSchema>> = {
  type: 'crawl_repos',
  schema: reposPayloadSchema,
  priority: PRIORITY.CRAWL,
  async run(payload, ctx) {
    const login = await indexedLogin(payload.githubId);
    if (login === null) return { kind: 'done', resultRef: { skipped: 'not_indexed' } };
    if (!(await guardStorage())) return { kind: 'done', resultRef: { skipped: 'full' } };
    const now = ctx.now();
    try {
      const repos = await listUserRepos(githubFor(SERVER_IDENTITY, { now: ctx.now }), login, { limit: await getSetting('crawler.reposPerUser'), deadline: ctx.deadline });
      const own = repos.filter((repo) => !repo.isFork && !repo.isPrivate);
      await upsertGhRepos(own.map((repo) => repoRow(repo, now)));
      return { kind: 'done', resultRef: { repos: own.length } };
    } catch (error) {
      if (!(error instanceof GitHubNotFoundError)) throw error;
      await removeFromCountryIndex(payload.githubId);
      return { kind: 'done', resultRef: { removed: true } };
    }
  },
};

export const optOutSchema = z.object({ login: loginSchema });

/**
 * The public opt-out (§8 F18 "Privacy"): anyone may ask that a GitHub login never be indexed. It only
 * removes data, so it needs no proof of ownership; the login is recorded and its index rows go now.
 */
export async function optOutOfCountryIndex(raw: unknown): Promise<string> {
  const { login } = optOutSchema.parse(raw);
  await optOutOfIndex(login);
  return login;
}

export type CrawlerOverview = CrawlerStatus & { limits: { maxUsers: number; maxRepos: number }; refreshDays: number; searchCap: number };

/** What `/admin/crawler` shows; admins only. */
export async function getCrawlerOverview(actor: Pick<Member, 'roles'>): Promise<CrawlerOverview> {
  if (!hasRole(actor, 'admin')) throw new ForbiddenError('crawler.forbidden', 'Only admins can see the crawler.');
  const [status, maxUsers, maxRepos, refreshDays, searchCap] = await Promise.all([
    crawlerStatus(),
    getSetting('crawler.maxUsers'),
    getSetting('crawler.maxRepos'),
    getSetting('crawler.refreshDays'),
    getSetting('crawler.searchCap'),
  ]);
  return { ...status, limits: { maxUsers, maxRepos }, refreshDays, searchCap };
}
