import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { serverEnv } from '@commitmates/env/server';

import { ConfigError } from './errors';

/**
 * Token encryption at rest (CLAUDE.md §5.10): AES-256-GCM with a versioned key.
 * Format: v<keyVersion>.<ivB64>.<tagB64>.<cipherB64>
 */

const ALGORITHM = 'aes-256-gcm';
/** Bytes in a GCM nonce, as recommended by NIST SP 800-38D. */
const IV_BYTES = 12;
/** Parts in the serialized format: version, iv, tag, ciphertext. */
const PART_COUNT = 4;

export type EncryptionKeys = {
  current: { version: number; key: string };
  /** The key being rotated out; accepted for decryption only. */
  previous?: string | undefined;
};

function keysFromEnv(): EncryptionKeys {
  return {
    current: { version: serverEnv.TOKEN_ENCRYPTION_KEY_VERSION, key: serverEnv.TOKEN_ENCRYPTION_KEY },
    previous: serverEnv.TOKEN_ENCRYPTION_KEY_PREV,
  };
}

const decodeKey = (key: string) => Buffer.from(key, 'base64');

export function encrypt(plain: string, keys: EncryptionKeys = keysFromEnv()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, decodeKey(keys.current.key), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    `v${keys.current.version}`,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** The key version a stored token was encrypted with. */
export function keyVersionOf(token: string): number {
  const match = /^v(\d+)\./.exec(token);
  if (!match?.[1]) throw new ConfigError('crypto.malformed', 'Encrypted value has no version prefix');
  return Number(match[1]);
}

/** Decrypts with the current key, or the previous one for tokens from before a rotation. */
export function decrypt(token: string, keys: EncryptionKeys = keysFromEnv()): string {
  const parts = token.split('.');
  const [, iv, tag, ciphertext] = parts;
  if (parts.length !== PART_COUNT || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new ConfigError('crypto.malformed', 'Encrypted value is not in the expected format');
  }
  const version = keyVersionOf(token);
  const key = version === keys.current.version ? keys.current.key : keys.previous;
  if (key === undefined) {
    throw new ConfigError('crypto.unknown_key_version', `No key available for version ${version}`);
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, decodeKey(key), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new ConfigError('crypto.decrypt_failed', 'Value could not be decrypted with the available keys', {
      cause: error,
    });
  }
}
