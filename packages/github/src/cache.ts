import { getDb, schema, type DbOrTx } from '@commitmates/db';
import { and, eq } from 'drizzle-orm';

import { identityKey, type TokenIdentity } from './identity';

const { apiCache } = schema;

export type CachedResponse = { etag: string | null; lastModified: string | null; body: unknown };

/** Conditional-request cache for REST GETs. ETags are tied to the token, so the key includes the identity. */
export async function readCache(identity: TokenIdentity, url: string, db: DbOrTx = getDb()): Promise<CachedResponse | null> {
  const [row] = await db
    .select({ etag: apiCache.etag, lastModified: apiCache.lastModified, body: apiCache.body })
    .from(apiCache)
    .where(and(eq(apiCache.tokenIdentity, identityKey(identity)), eq(apiCache.method, 'GET'), eq(apiCache.url, url)));
  if (!row || (row.etag === null && row.lastModified === null)) return null;
  return row;
}

export async function writeCache(
  identity: TokenIdentity,
  url: string,
  response: { status: number; etag: string | null; lastModified: string | null; body: unknown },
  now: Date,
  db: DbOrTx = getDb(),
): Promise<void> {
  const values = {
    etag: response.etag,
    lastModified: response.lastModified,
    status: response.status,
    body: response.body,
    fetchedAt: now,
  };
  await db
    .insert(apiCache)
    .values({ tokenIdentity: identityKey(identity), method: 'GET', url, ...values })
    .onConflictDoUpdate({ target: [apiCache.tokenIdentity, apiCache.method, apiCache.url], set: values });
}
