import { decrypt, getDb, schema, type DbOrTx } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import { eq } from 'drizzle-orm';

import { GitHubAuthError } from './errors';

/**
 * Which token a call spends (CLAUDE.md §5.6). Exactly two kinds: a member's own OAuth
 * token for their own analyses, and the server token for anonymous tools and syncs.
 * An identity is never chosen to dodge a limit, and there are no extra tokens.
 */
export type TokenIdentity = { kind: 'user'; userId: string } | { kind: 'server' };

export const SERVER_IDENTITY: TokenIdentity = { kind: 'server' };

/** Key used in `api_cache` and `github_budgets`: `'server'` or `'user:<uuid>'`. */
export function identityKey(identity: TokenIdentity): string {
  return identity.kind === 'server' ? 'server' : `user:${identity.userId}`;
}

/** Resolves the token for an identity. A member's token is decrypted per call and never cached. */
export async function resolveToken(identity: TokenIdentity, db: DbOrTx = getDb()): Promise<string> {
  if (identity.kind === 'server') return serverEnv.GITHUB_SERVER_TOKEN;

  const [row] = await db
    .select({ tokenEnc: schema.githubIdentities.tokenEnc, tokenInvalid: schema.githubIdentities.tokenInvalid })
    .from(schema.githubIdentities)
    .where(eq(schema.githubIdentities.userId, identity.userId));
  if (!row?.tokenEnc || row.tokenInvalid) throw new GitHubAuthError();
  return decrypt(row.tokenEnc);
}

/** Marks a member's token as unusable so the app prompts them to sign in again. */
export async function markTokenInvalid(identity: TokenIdentity, db: DbOrTx = getDb()): Promise<void> {
  if (identity.kind !== 'user') return;
  await db
    .update(schema.githubIdentities)
    .set({ tokenInvalid: true })
    .where(eq(schema.githubIdentities.userId, identity.userId));
}
