import { RateLimitError, getDb, getSetting, schema, type DbOrTx } from '@commitmates/db';
import { and, eq } from 'drizzle-orm';

import { identityKey, type TokenIdentity } from './identity';

const { githubBudgets } = schema;

/** Rate-limit resources we reserve budget for. The value of `x-ratelimit-resource`. */
export type BudgetResource = 'core' | 'search' | 'graphql';

export type RateLimitState = { resource: string; limit: number; remaining: number; resetAt: Date };

const MS_PER_SECOND = 1000;

const header = (headers: Record<string, unknown>, name: string): string | undefined => {
  const value = headers[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

/** Reads GitHub's rate-limit headers. Limits are always read, never assumed (CLAUDE.md §2.5). */
export function parseRateLimitHeaders(headers: Record<string, unknown>): RateLimitState | null {
  const resource = header(headers, 'x-ratelimit-resource');
  const limit = Number(header(headers, 'x-ratelimit-limit'));
  const remaining = Number(header(headers, 'x-ratelimit-remaining'));
  const reset = Number(header(headers, 'x-ratelimit-reset'));
  if (!resource || !Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) return null;
  return { resource, limit, remaining, resetAt: new Date(reset * MS_PER_SECOND) };
}

export async function recordBudget(
  identity: TokenIdentity,
  state: RateLimitState,
  db: DbOrTx = getDb(),
): Promise<void> {
  const values = { limit: state.limit, remaining: state.remaining, resetAt: state.resetAt, updatedAt: new Date() };
  await db
    .insert(githubBudgets)
    .values({ tokenIdentity: identityKey(identity), resource: state.resource, ...values })
    .onConflictDoUpdate({ target: [githubBudgets.tokenIdentity, githubBudgets.resource], set: values });
}

export async function hasBudgetRows(identity: TokenIdentity, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .select({ resource: githubBudgets.resource })
    .from(githubBudgets)
    .where(eq(githubBudgets.tokenIdentity, identityKey(identity)))
    .limit(1);
  return rows.length > 0;
}

const reserveKey = {
  core: 'github.reserve.core',
  search: 'github.reserve.search',
  graphql: 'github.reserve.graphql',
} as const;

/**
 * Throws `RateLimitError(resetAt)` when spending `cost` would dip into the reserve
 * (`github.reserve.<resource>`). A window that has already reset is treated as full.
 */
export async function ensureBudget(
  identity: TokenIdentity,
  resource: BudgetResource,
  cost: number,
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  const [row] = await db
    .select()
    .from(githubBudgets)
    .where(and(eq(githubBudgets.tokenIdentity, identityKey(identity)), eq(githubBudgets.resource, resource)));
  const remaining = row?.remaining ?? null;
  const resetAt = row?.resetAt ?? null;
  if (remaining === null || resetAt === null) return;
  if (resetAt.getTime() <= now.getTime()) return;

  const reserve = await getSetting(reserveKey[resource], db);
  if (remaining - cost < reserve) throw new RateLimitError(resetAt, { resource });
}

/** Search rate limits are per minute. */
const SEARCH_WINDOW_MS = 60_000;
/** Upper bound of the random extra gap between search calls (CLAUDE.md §5.6). */
const PACER_JITTER_MS = 250;

export type PacerOptions = {
  now: () => Date;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Longest pause worth taking inline; a longer one becomes a `RateLimitError` so the job waits instead. */
  maxWaitMs: number;
};

/**
 * Search pacer: spaces search calls for one identity across every process. The row
 * lock serializes callers; the minimum gap is derived from the limit GitHub reported.
 */
export async function paceSearch(identity: TokenIdentity, options: PacerOptions, db: DbOrTx = getDb()): Promise<void> {
  const key = identityKey(identity);
  await db.transaction(async (tx) => {
    await tx
      .insert(githubBudgets)
      .values({ tokenIdentity: key, resource: 'search', updatedAt: options.now() })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(githubBudgets)
      .where(and(eq(githubBudgets.tokenIdentity, key), eq(githubBudgets.resource, 'search')))
      .for('update');

    const now = options.now();
    if (row?.limit && row.lastCallAt) {
      const minGapMs = Math.ceil(SEARCH_WINDOW_MS / row.limit) + options.random() * PACER_JITTER_MS;
      const waitMs = row.lastCallAt.getTime() + minGapMs - now.getTime();
      if (waitMs > options.maxWaitMs) {
        throw new RateLimitError(new Date(now.getTime() + waitMs), { resource: 'search' });
      }
      if (waitMs > 0) await options.sleep(waitMs);
    }
    await tx
      .update(githubBudgets)
      .set({ lastCallAt: options.now() })
      .where(and(eq(githubBudgets.tokenIdentity, key), eq(githubBudgets.resource, 'search')));
  });
}
