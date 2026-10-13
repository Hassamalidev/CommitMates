import { describe, expect, it } from 'vitest';

import { decrypt, encrypt, keyVersionOf, type EncryptionKeys } from './crypto';
import { ConfigError } from './errors';

const keyA = Buffer.alloc(32, 1).toString('base64');
const keyB = Buffer.alloc(32, 2).toString('base64');
const v1: EncryptionKeys = { current: { version: 1, key: keyA } };

describe('token encryption', () => {
  it('round-trips a value', () => {
    const token = encrypt('gho_example-token-value', v1);
    expect(token).toMatch(/^v1\.[\w+/=]+\.[\w+/=]+\.[\w+/=]+$/);
    expect(token).not.toContain('gho_example');
    expect(decrypt(token, v1)).toBe('gho_example-token-value');
  });

  it('uses a fresh IV every time', () => {
    expect(encrypt('same', v1)).not.toBe(encrypt('same', v1));
  });

  it('handles empty and unicode values', () => {
    expect(decrypt(encrypt('', v1), v1)).toBe('');
    expect(decrypt(encrypt('pässwörd-🔑', v1), v1)).toBe('pässwörd-🔑');
  });

  it('decrypts old tokens with the previous key during a rotation', () => {
    const old = encrypt('secret', v1);
    const rotated: EncryptionKeys = { current: { version: 2, key: keyB }, previous: keyA };
    expect(keyVersionOf(old)).toBe(1);
    expect(decrypt(old, rotated)).toBe('secret');

    const fresh = encrypt('secret', rotated);
    expect(keyVersionOf(fresh)).toBe(2);
    expect(decrypt(fresh, rotated)).toBe('secret');
  });

  it('refuses old tokens once the previous key is removed', () => {
    const old = encrypt('secret', v1);
    expect(() => decrypt(old, { current: { version: 2, key: keyB } })).toThrow(/unknown_key_version/);
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const token = encrypt('secret', v1);
    const parts = token.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('other').toString('base64')].join('.');
    expect(() => decrypt(tampered, v1)).toThrow(ConfigError);
    expect(() => decrypt(token, { current: { version: 1, key: keyB } })).toThrow(/decrypt_failed/);
  });

  it('rejects malformed input', () => {
    expect(() => decrypt('not-encrypted', v1)).toThrow(/malformed/);
    expect(() => decrypt('v1.a.b', v1)).toThrow(/malformed/);
    expect(() => keyVersionOf('x1.a.b.c')).toThrow(/malformed/);
  });
});
