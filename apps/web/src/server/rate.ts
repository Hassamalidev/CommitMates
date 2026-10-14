import 'server-only';

import { guardRate, hashIp } from '@commitmates/core';

/**
 * The caller's address as reported by the hosting proxy. It is used only to derive a
 * salted hash and is never stored or logged (CLAUDE.md §2.6).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded ?? headers.get('x-real-ip')?.trim() ?? 'unknown';
}

/** `sha256(ip + daily_salt)` for the current request. */
export function requestIpHash(headers: Headers, now: Date = new Date()): Promise<string> {
  return hashIp(clientIp(headers), now);
}

/**
 * Rate limit for day-one tools (CLAUDE.md §5.3 step 2): one bucket per tool and IP hash,
 * plus one per member when signed in. Throws `RateLimitedError` when either is empty.
 */
export async function guardToolRate(tool: string, headers: Headers, userId?: string): Promise<string> {
  const ipHash = await requestIpHash(headers);
  await guardRate(`tool:${tool}:ip:${ipHash}`, 'rate.tool');
  if (userId !== undefined) await guardRate(`tool:${tool}:user:${userId}`, 'rate.tool');
  return ipHash;
}

/** Rate limit for member writes: one bucket per member. */
export function guardWriteRate(userId: string): Promise<void> {
  return guardRate(`write:${userId}`, 'rate.write');
}
