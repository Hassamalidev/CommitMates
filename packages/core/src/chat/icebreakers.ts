/**
 * Icebreakers for a first message (CLAUDE.md §8 F12 "Message requests" step 1, §2.1): a template key
 * plus one real shared signal from the suggestion, never generated text. The page fills the template
 * from its copy; the key and value are stored with the request.
 */

export const ICEBREAKER_KEYS = ['sharedTag', 'learning', 'interests'] as const; // allowed-literal: template keys in copy/icebreakers.ts
export type IcebreakerKey = (typeof ICEBREAKER_KEYS)[number];
export type Icebreaker = { key: IcebreakerKey; value: string };

type Signals = { sharedTags: readonly string[]; coverage: readonly string[]; sharedInterests: number };

/**
 * The icebreakers a suggestion's signals support: a tag both build with, a learning goal the other
 * person covers (only when it really is one of the member's goals), and the count of shared topics.
 */
export function icebreakersFor(signals: Signals, goals: readonly string[]): Icebreaker[] {
  const options: Icebreaker[] = [];
  const shared = signals.sharedTags[0];
  if (shared) options.push({ key: 'sharedTag', value: shared });
  const goalSet = new Set(goals);
  const learning = signals.coverage.find((tag) => goalSet.has(tag));
  if (learning) options.push({ key: 'learning', value: learning });
  if (signals.sharedInterests > 0) options.push({ key: 'interests', value: String(signals.sharedInterests) });
  return options;
}

/** `key:value`, as stored in `message_requests.icebreaker_key` and sent by forms. */
export const icebreakerId = (icebreaker: Icebreaker): string => `${icebreaker.key}:${icebreaker.value}`;

/** Reads `key:value` back; null for anything that is not a known key with a value. */
export function parseIcebreakerId(id: string): Icebreaker | null {
  const split = id.indexOf(':');
  if (split <= 0 || split === id.length - 1) return null;
  const key = id.slice(0, split);
  const known = (ICEBREAKER_KEYS as readonly string[]).includes(key);
  return known ? { key: key as IcebreakerKey, value: id.slice(split + 1) } : null;
}
