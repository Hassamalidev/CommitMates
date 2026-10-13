import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets in constant time. Hashing first makes the comparison
 * independent of either value's length.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
