import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@commitmates/env/server';

/** Digits in a one-time code. */
const OTP_DIGITS = 6;
/** Exclusive upper bound of the code space: 10^6. */
const OTP_SPACE = 1_000_000;

/** A uniformly random six-digit code, zero-padded (CLAUDE.md §5.10). */
export function generateOtp(): string {
  return String(randomInt(0, OTP_SPACE)).padStart(OTP_DIGITS, '0');
}

/** `sha256(code + pepper)`. Only the hash is stored; the code itself is never logged. */
export function hashOtp(code: string, pepper: string = serverEnv.OTP_PEPPER): string {
  return createHash('sha256').update(code).update(pepper).digest('hex');
}

/** Compares a submitted code with a stored hash in constant time. */
export function verifyOtp(code: string, expectedHash: string, pepper: string = serverEnv.OTP_PEPPER): boolean {
  const actual = Buffer.from(hashOtp(code, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
