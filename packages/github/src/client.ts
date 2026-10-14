import { getDb, getLogger, getSetting, type Db } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import { Octokit } from '@octokit/core';
import { RequestError } from '@octokit/request-error';
import { z } from 'zod';

import {
  ensureBudget,
  hasBudgetRows,
  paceSearch,
  parseRateLimitHeaders,
  recordBudget,
  type BudgetResource,
} from './budgets';
import { readCache, writeCache } from './cache';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubServerError,
  GitHubValidationError,
  RateLimitError,
} from './errors';
import { identityKey, markTokenInvalid, resolveToken, type TokenIdentity } from './identity';

/** HTTP statuses GitHub uses that the client branches on (protocol constants). */
const HTTP = {
  ACCEPTED: 202,
  NOT_MODIFIED: 304,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
} as const;
const MS_PER_SECOND = 1000;
/** First pause after a secondary rate limit without `retry-after`; doubles each time (CLAUDE.md §5.6). */
const SECONDARY_LIMIT_BASE_MS = 60_000;
/** Longest search-pacer pause taken inline when the caller gives no deadline. */
const DEFAULT_MAX_PACER_WAIT_MS = 5000;
/** Pause before the first retry of a 202 "still computing" answer; grows linearly. */
const STATS_RETRY_BASE_MS = 1000;
/** Cost assumed for a GraphQL query before GitHub reports the real one. */
const GRAPHQL_ASSUMED_COST = 1;

export type Params = Record<string, string | number | boolean | undefined>;

export type RequestOptions = {
  /** What to call the thing in a "couldn't find …" message, e.g. `@login` or `owner/repo`. */
  what?: string;
  /** Epoch ms the caller must finish by; bounds inline waits. */
  deadline?: number;
  /** Extra `Accept` media type, e.g. the stargazer timestamps format. */
  accept?: string;
};

export type Page<T> = { items: T[]; truncated: boolean };

export type StatsResult<T> = { pending: false; data: T } | { pending: true };

export type ClientDeps = {
  db?: Db;
  now?: () => Date;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const rateLimitSchema = z.object({
  resources: z.record(z.string(), z.object({ limit: z.number(), remaining: z.number(), reset: z.number() })),
});

const graphqlRateLimitSchema = z.object({
  limit: z.number(),
  cost: z.number(),
  remaining: z.number(),
  resetAt: z.string(),
});

const graphqlEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(z.object({ type: z.string().optional(), message: z.string() })).optional(),
});

/** Selection every GraphQL query must include so budgets stay current (CLAUDE.md §5.6). */
export const RATE_LIMIT_FRAGMENT = 'rateLimit { limit cost remaining resetAt }';

// Consecutive secondary-limit hits per identity, to back off exponentially when GitHub gives no hint.
const secondaryHits = new Map<string, number>();

/** Test helper: forget in-process state. */
export function resetGitHubClientState(): void {
  secondaryHits.clear();
}

function parse<T>(schema: z.ZodType<T>, data: unknown, url: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new GitHubServerError(`Response from ${url} did not match its schema`, { cause: result.error });
  }
  return result.data;
}

const headerValue = (headers: Record<string, unknown>, name: string): string | null => {
  const value = headers[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
};

/** `rel="next"` from a Link header, if any. */
function hasNextPage(headers: Record<string, unknown>): boolean {
  return (headerValue(headers, 'link') ?? '').includes('rel="next"');
}

export class GitHubClient {
  readonly identity: TokenIdentity;
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private octokit: Octokit | undefined;

  constructor(identity: TokenIdentity, deps: ClientDeps = {}) {
    this.identity = identity;
    this.db = deps.db ?? getDb();
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async kit(): Promise<Octokit> {
    if (this.octokit) return this.octokit;
    const [token, userAgent] = await Promise.all([
      resolveToken(this.identity, this.db),
      getSetting('sources.userAgent', this.db),
    ]);
    this.octokit = new Octokit({ auth: token, userAgent: `${userAgent} (${serverEnv.CONTACT_EMAIL})` });
    return this.octokit;
  }

  /** Before the first call for an identity, read its limits from `/rate_limit` (free of charge). */
  private async ensureInitialized(): Promise<void> {
    if (await hasBudgetRows(this.identity, this.db)) return;
    const kit = await this.kit();
    const response = await this.send(kit, 'GET /rate_limit', {}, {});
    const { resources } = parse(rateLimitSchema, response.data, '/rate_limit');
    for (const [resource, state] of Object.entries(resources)) {
      await recordBudget(
        this.identity,
        { resource, limit: state.limit, remaining: state.remaining, resetAt: new Date(state.reset * MS_PER_SECOND) },
        this.db,
      );
    }
  }

  /** Sends one request, records the budget headers, and maps failures to typed errors. */
  private async send(
    kit: Octokit,
    route: string,
    params: Record<string, unknown>,
    options: RequestOptions & { headers?: Record<string, string> },
  ): Promise<{ status: number; headers: Record<string, unknown>; data: unknown }> {
    const timeoutMs = await getSetting('github.requestTimeoutMs', this.db);
    try {
      const response = await kit.request(route, {
        ...params,
        headers: { ...(options.accept ? { accept: options.accept } : {}), ...options.headers },
        request: { signal: AbortSignal.timeout(timeoutMs) },
      });
      const headers = response.headers as Record<string, unknown>;
      await this.afterResponse(headers);
      return { status: response.status, headers, data: response.data };
    } catch (error) {
      if (!(error instanceof RequestError)) {
        throw new GitHubServerError(`Request to ${route} failed before a response arrived`, { cause: error });
      }
      const headers = (error.response?.headers ?? {}) as Record<string, unknown>;
      await this.afterResponse(headers);
      if (error.status === HTTP.NOT_MODIFIED) return { status: HTTP.NOT_MODIFIED, headers, data: null };
      throw await this.mapError(error, headers, options);
    }
  }

  private async afterResponse(headers: Record<string, unknown>): Promise<void> {
    const state = parseRateLimitHeaders(headers);
    if (state) await recordBudget(this.identity, state, this.db);
  }

  private async mapError(error: RequestError, headers: Record<string, unknown>, options: RequestOptions): Promise<Error> {
    const requestId = headerValue(headers, 'x-github-request-id');
    const log = getLogger().child({ ghRequestId: requestId, status: error.status, identity: this.identity.kind });
    const key = identityKey(this.identity);

    if (error.status === HTTP.FORBIDDEN || error.status === HTTP.TOO_MANY_REQUESTS) {
      const retryAfter = Number(headerValue(headers, 'retry-after'));
      const state = parseRateLimitHeaders(headers);
      const now = this.now().getTime();
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        log.warn('GitHub secondary rate limit');
        return new RateLimitError(new Date(now + retryAfter * MS_PER_SECOND), { cause: error });
      }
      if (state?.remaining === 0) {
        log.warn('GitHub primary rate limit exhausted');
        return new RateLimitError(state.resetAt, { cause: error, resource: state.resource });
      }
      const isSecondary = error.status === HTTP.TOO_MANY_REQUESTS || /secondary rate limit|abuse/i.test(error.message);
      if (isSecondary) {
        const hits = secondaryHits.get(key) ?? 0;
        secondaryHits.set(key, hits + 1);
        log.warn({ hits: hits + 1 }, 'GitHub secondary rate limit without retry-after');
        return new RateLimitError(new Date(now + SECONDARY_LIMIT_BASE_MS * 2 ** hits), { cause: error }); // allowed-literal: doubling backoff
      }
      return new GitHubForbiddenError({ cause: error });
    }

    if (error.status === HTTP.UNAUTHORIZED) {
      await markTokenInvalid(this.identity, this.db);
      log.warn('GitHub rejected the token');
      return new GitHubAuthError({ cause: error });
    }
    if (error.status === HTTP.NOT_FOUND) return new GitHubNotFoundError(options.what ?? 'that', { cause: error });
    if (error.status === HTTP.UNPROCESSABLE) return new GitHubValidationError({ cause: error });

    log.warn('GitHub request failed');
    return new GitHubServerError(`GitHub answered ${error.status}`, { cause: error });
  }

  private async prepare(resource: BudgetResource, cost: number): Promise<Octokit> {
    const kit = await this.kit();
    await this.ensureInitialized();
    await ensureBudget(this.identity, resource, cost, this.now(), this.db);
    return kit;
  }

  private async conditionalGet(
    route: string,
    params: Params,
    options: RequestOptions,
    resource: BudgetResource,
  ): Promise<{ status: number; headers: Record<string, unknown>; data: unknown; url: string }> {
    const kit = await this.prepare(resource, 1);
    const url = kit.request.endpoint(route, params).url;
    const cached = await readCache(this.identity, url, this.db);
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;

    const response = await this.send(kit, route, params, { ...options, headers });
    secondaryHits.delete(identityKey(this.identity));

    if (response.status === HTTP.NOT_MODIFIED && cached) {
      return { status: HTTP.NOT_MODIFIED, headers: response.headers, data: cached.body, url };
    }
    if (response.status !== HTTP.ACCEPTED) {
      await writeCache(
        this.identity,
        url,
        {
          status: response.status,
          etag: headerValue(response.headers, 'etag'),
          lastModified: headerValue(response.headers, 'last-modified'),
          body: response.data,
        },
        this.now(),
        this.db,
      );
    }
    return { ...response, url };
  }

  /** A REST GET with the ETag cache, budget check and schema validation. */
  async get<T>(route: string, params: Params, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    const response = await this.conditionalGet(route, params, options, 'core');
    return parse(schema, response.data, response.url);
  }

  /**
   * Follows `Link: rel="next"` up to `maxPages` (default `github.maxPages.default`).
   * `truncated` is true when more pages existed than were read.
   */
  async paginate<T>(
    route: string,
    params: Params,
    itemSchema: z.ZodType<T>,
    options: RequestOptions & { maxPages?: number; perPage?: number } = {},
  ): Promise<Page<T>> {
    const maxPages = options.maxPages ?? (await getSetting('github.maxPages.default', this.db));
    const perPage = options.perPage ?? GITHUB_MAX_PER_PAGE;
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await this.conditionalGet(route, { ...params, per_page: perPage, page }, options, 'core');
      const pageItems = parse(z.array(itemSchema), response.data, response.url);
      items.push(...pageItems);
      // A cached page carries no Link header; a full page means there may be more.
      const more = response.status === HTTP.NOT_MODIFIED ? pageItems.length === perPage : hasNextPage(response.headers);
      if (!more) return { items, truncated: false };
    }
    return { items, truncated: true };
  }

  /** A search call: paced per identity and charged to the stricter search budget. */
  async search<T>(route: string, params: Params, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    const kit = await this.prepare('search', 1);
    const maxWaitMs =
      options.deadline === undefined ? DEFAULT_MAX_PACER_WAIT_MS : Math.max(0, options.deadline - Date.now());
    await paceSearch(
      this.identity,
      { now: this.now, random: this.random, sleep: this.sleep, maxWaitMs },
      this.db,
    );
    const response = await this.send(kit, route, params, options);
    secondaryHits.delete(identityKey(this.identity));
    return parse(schema, response.data, route);
  }

  /**
   * `/stats/*` endpoints answer 202 while GitHub computes. Retries up to
   * `fairness.statsRetryMax` times inside the deadline, then reports `pending`
   * so the job can return `wait` (CLAUDE.md §5.6).
   */
  async stats<T>(route: string, params: Params, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<StatsResult<T>> {
    const retryMax = await getSetting('fairness.statsRetryMax', this.db);
    for (let attempt = 0; attempt <= retryMax; attempt += 1) {
      const response = await this.conditionalGet(route, params, options, 'core');
      if (response.status !== HTTP.ACCEPTED) {
        return { pending: false, data: parse(schema, response.data, response.url) };
      }
      const pauseMs = STATS_RETRY_BASE_MS * (attempt + 1);
      if (attempt === retryMax || (options.deadline !== undefined && Date.now() + pauseMs >= options.deadline)) break;
      await this.sleep(pauseMs);
    }
    return { pending: true };
  }

  /**
   * A GraphQL query. The query must select `rateLimit { limit cost remaining resetAt }`
   * (use `RATE_LIMIT_FRAGMENT`); the result is validated and the budget updated from it.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!query.includes('rateLimit')) {
      throw new GitHubServerError('GraphQL query does not select rateLimit; add RATE_LIMIT_FRAGMENT');
    }
    const kit = await this.prepare('graphql', GRAPHQL_ASSUMED_COST);
    const response = await this.send(kit, 'POST /graphql', { query, variables }, options);
    secondaryHits.delete(identityKey(this.identity));

    const envelope = parse(graphqlEnvelopeSchema, response.data, '/graphql');
    const data = envelope.data ?? {};
    const rate = graphqlRateLimitSchema.safeParse(data.rateLimit);
    if (rate.success) {
      await recordBudget(
        this.identity,
        {
          resource: 'graphql',
          limit: rate.data.limit,
          remaining: rate.data.remaining,
          resetAt: new Date(rate.data.resetAt),
        },
        this.db,
      );
    }

    if (envelope.errors && envelope.errors.length > 0) {
      const types = new Set(envelope.errors.map((error) => error.type));
      if (types.has('RATE_LIMITED')) {
        const resetAt = rate.success
          ? new Date(rate.data.resetAt)
          : new Date(this.now().getTime() + SECONDARY_LIMIT_BASE_MS);
        throw new RateLimitError(resetAt, { resource: 'graphql' });
      }
      if (types.has('NOT_FOUND')) throw new GitHubNotFoundError(options.what ?? 'that');
      if (types.has('FORBIDDEN')) throw new GitHubForbiddenError();
      throw new GitHubServerError(`GraphQL errors: ${envelope.errors.map((error) => error.message).join('; ')}`);
    }
    return parse(schema, data, '/graphql');
  }
}

/** Largest `per_page` GitHub accepts. */
const GITHUB_MAX_PER_PAGE = 100;

/** The budget-aware client for an identity. */
export function githubFor(identity: TokenIdentity, deps: ClientDeps = {}): GitHubClient {
  return new GitHubClient(identity, deps);
}

export { graphqlEnvelopeSchema, graphqlRateLimitSchema };
