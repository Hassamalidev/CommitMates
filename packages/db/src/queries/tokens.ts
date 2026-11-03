import { and, asc, eq, gt, isNotNull, ne, or, isNull } from 'drizzle-orm';

import { getDb, type DbOrTx } from '../client';
import { githubIdentities } from '../schema';

export type StoredToken = { userId: string; tokenEnc: string };

/**
 * Stored GitHub tokens not encrypted with `currentVersion`, in user-id order after `after`
 * (CLAUDE.md §5.10 "Token encryption": rotation).
 */
export async function tokensNotOnVersion(currentVersion: number, after: string | null, limit: number, db: DbOrTx = getDb()): Promise<StoredToken[]> {
  const rows = await db
    .select({ userId: githubIdentities.userId, tokenEnc: githubIdentities.tokenEnc })
    .from(githubIdentities)
    .where(
      and(
        isNotNull(githubIdentities.tokenEnc),
        or(isNull(githubIdentities.tokenKeyVersion), ne(githubIdentities.tokenKeyVersion, currentVersion)),
        after === null ? undefined : gt(githubIdentities.userId, after),
      ),
    )
    .orderBy(asc(githubIdentities.userId))
    .limit(limit);
  return rows.flatMap((row) => (row.tokenEnc === null ? [] : [{ userId: row.userId, tokenEnc: row.tokenEnc }]));
}

/** Replaces a stored token, but only if it is still the one that was read. */
export async function replaceToken(userId: string, previous: string, tokenEnc: string, version: number, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(githubIdentities)
    .set({ tokenEnc, tokenKeyVersion: version })
    .where(and(eq(githubIdentities.userId, userId), eq(githubIdentities.tokenEnc, previous)));
}

/** Drops a token that no key can read; the member is asked to sign in again. */
export async function dropUnreadableToken(userId: string, previous: string, db: DbOrTx = getDb()): Promise<void> {
  await db
    .update(githubIdentities)
    .set({ tokenEnc: null, tokenKeyVersion: null, tokenInvalid: true })
    .where(and(eq(githubIdentities.userId, userId), eq(githubIdentities.tokenEnc, previous)));
}
