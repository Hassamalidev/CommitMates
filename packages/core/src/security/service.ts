import { RateLimitedError, getSetting, takeToken } from '@commitmates/db';

/** Unit conversion. */
const SECONDS_PER_MINUTE = 60;

/** Settings prefixes that define a bucket: `<prefix>.capacity` and `<prefix>.refillPerMin`. */
export type RatePrefix = 'rate.tool' | 'rate.write';

/**
 * Takes one token from the bucket `key`, sized by the settings under `prefix`.
 * Throws `RateLimitedError` with a retry hint when the bucket is empty (CLAUDE.md §5.10).
 */
export async function guardRate(key: string, prefix: RatePrefix): Promise<void> {
  const [capacity, refillPerMin] = await Promise.all([
    getSetting(`${prefix}.capacity`),
    getSetting(`${prefix}.refillPerMin`),
  ]);
  const allowed = await takeToken(key, capacity, refillPerMin / SECONDS_PER_MINUTE);
  if (allowed) return;

  const retryAfterSeconds = refillPerMin > 0 ? Math.ceil(SECONDS_PER_MINUTE / refillPerMin) : SECONDS_PER_MINUTE;
  throw new RateLimitedError(
    'rate.limited',
    `You're going a bit fast. Try again in about ${retryAfterSeconds} seconds.`,
    retryAfterSeconds,
  );
}
