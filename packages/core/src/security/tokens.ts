import { ConfigError, decrypt, dropUnreadableToken, encrypt, getLogger, replaceToken, tokensNotOnVersion, type EncryptionKeys } from '@commitmates/db';
import { serverEnv } from '@commitmates/env/server';
import { PRIORITY, enqueue, type JobHandler } from '@commitmates/jobs';
import { z } from 'zod';

/** Tokens read per query; the job stops at its deadline and continues where it left off. */
const PAGE_SIZE = 100;
/** Time kept in hand before the deadline. */
const DEADLINE_MARGIN_MS = 2000;

const keysFromEnv = (): EncryptionKeys => ({
  current: { version: serverEnv.TOKEN_ENCRYPTION_KEY_VERSION, key: serverEnv.TOKEN_ENCRYPTION_KEY },
  previous: serverEnv.TOKEN_ENCRYPTION_KEY_PREV,
});

export type ReencryptOutcome = { reencrypted: number; dropped: number; after: string | null; done: boolean };

/**
 * Re-encrypts stored GitHub tokens with the current key (CLAUDE.md §5.10 "Token encryption",
 * `docs/runbooks/rotate-token-key.md`): every token on another key version is decrypted with the
 * previous key and written back under the current one, unless it changed meanwhile. A token neither
 * key can read is dropped and its member asked to sign in again. A missing previous key stops the run
 * instead, so a configuration mistake never wipes tokens.
 */
export async function reencryptTokens(after: string | null, deadline: number, keys: EncryptionKeys = keysFromEnv()): Promise<ReencryptOutcome> {
  let cursor = after;
  let reencrypted = 0;
  let dropped = 0;
  for (;;) {
    const page = await tokensNotOnVersion(keys.current.version, cursor, PAGE_SIZE);
    if (page.length === 0) return { reencrypted, dropped, after: cursor, done: true };
    for (const token of page) {
      if (Date.now() > deadline - DEADLINE_MARGIN_MS) return { reencrypted, dropped, after: cursor, done: false };
      let plain: string;
      try {
        plain = decrypt(token.tokenEnc, keys);
      } catch (error) {
        if (error instanceof ConfigError && error.code === 'crypto.decrypt_failed') {
          await dropUnreadableToken(token.userId, token.tokenEnc);
          dropped += 1;
          cursor = token.userId;
          continue;
        }
        throw error;
      }
      await replaceToken(token.userId, token.tokenEnc, encrypt(plain, keys), keys.current.version);
      reencrypted += 1;
      cursor = token.userId;
    }
  }
}

const payloadSchema = z.object({ keyVersion: z.number().int().positive(), after: z.uuid().nullable().default(null) });

/** `reencrypt_tokens` (CLAUDE.md §5.4): run by hand during a key rotation; continues across runs. */
export const reencryptTokensJob: JobHandler<z.infer<typeof payloadSchema>> = {
  type: 'reencrypt_tokens',
  schema: payloadSchema,
  priority: PRIORITY.MAINTENANCE,
  async run(payload, ctx) {
    if (payload.keyVersion !== serverEnv.TOKEN_ENCRYPTION_KEY_VERSION) {
      throw new ConfigError('crypto.version_mismatch', `This job re-encrypts for key version ${payload.keyVersion}, but the current key is version ${serverEnv.TOKEN_ENCRYPTION_KEY_VERSION}.`);
    }
    const outcome = await reencryptTokens(payload.after, ctx.deadline);
    getLogger().info({ jobType: 'reencrypt_tokens', ...outcome }, 'tokens re-encrypted');
    return outcome.done ? { kind: 'done', resultRef: outcome } : { kind: 'continue', payload: { keyVersion: payload.keyVersion, after: outcome.after } };
  },
};

/** Queues the re-encryption for the current key version (`pnpm tokens:reencrypt`); once per version. */
export async function queueTokenReencryption(): Promise<{ jobId: string; keyVersion: number }> {
  const keyVersion = serverEnv.TOKEN_ENCRYPTION_KEY_VERSION;
  const job = await enqueue('reencrypt_tokens', { keyVersion, after: null }, { idempotencyKey: `reencrypt:${keyVersion}`, priority: PRIORITY.MAINTENANCE });
  return { jobId: job.id, keyVersion };
}
