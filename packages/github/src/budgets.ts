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
  if (!resource || !Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset))
    return null;
  return { resource, limit, remaining, resetAt: new Date(reset * MS_PER_SECOND) };
}

export async function recordBudget(
  identity: TokenIdentity,
  state: RateLimitState,
  db: DbOrTx = getDb(),
): Promise<void> {
  const values = {
    limit: state.limit,
    remaining: state.remaining,
    resetAt: state.resetAt,
    updatedAt: new Date(),
  };
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

export type PacerOptions = {
  now: () => Date;
  /** Background work keeps `github.reserve.searchBackground` searches free for interactive tools. */
  background?: boolean;
};

/**
 * Search pacer: serializes search calls for one identity across every process (the row lock)
 * and spends the allowance GitHub last reported. Each call reserves one search under the lock,
 * so callers racing each other see it shrink; when the next call would dip into
 * `github.reserve.search`, the job waits for the window to reset. Calls go back to back while
 * the allowance lasts, instead of a fixed gap of a minute divided by the limit (ADR-014).
 */
export async function paceSearch(
  identity: TokenIdentity,
  options: PacerOptions,
  db: DbOrTx = getDb(),
): Promise<void> {
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
    // A window that has already reset is full again; the response's headers will say by how much.
    const remaining = row?.remaining ?? null;
    const resetAt = row?.resetAt ?? null;
    const windowOpen = remaining !== null && resetAt !== null && resetAt.getTime() > now.getTime();
    if (windowOpen) {
      const [reserve, backgroundReserve] = await Promise.all([
        getSetting('github.reserve.search', tx),
        options.background ? getSetting('github.reserve.searchBackground', tx) : Promise.resolve(0),
      ]);
      if (remaining - 1 < Math.max(reserve, backgroundReserve))
        throw new RateLimitError(resetAt, { resource: 'search' });
    }
    await tx
      .update(githubBudgets)
      .set({ lastCallAt: now, ...(windowOpen ? { remaining: remaining - 1 } : {}) })
      .where(and(eq(githubBudgets.tokenIdentity, key), eq(githubBudgets.resource, 'search')));
  });
}
