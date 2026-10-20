/**
 * Seeded randomness for reproducible fairness (CLAUDE.md §10.7: no Math.random in algorithms).
 * Formula: mulberry32 for the stream, FNV-1a for turning text into a seed, Fisher–Yates for shuffling.
 * Settings: none
 * Spec: CLAUDE.md §8 F11 "Deck" step 2 (processed in random order with a seeded RNG)
 */

/** A deterministic random stream in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0; // allowed-literal: mulberry32 increment
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1); // allowed-literal: mulberry32 shifts
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); // allowed-literal: mulberry32 shifts and multiplier
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // allowed-literal: 2^32, mulberry32 output scale
  };
}

/** A 32-bit seed from text (FNV-1a). */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5; // allowed-literal: FNV-1a offset basis
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193); // allowed-literal: FNV-1a prime
  }
  return hash >>> 0;
}

/** A shuffled copy (Fisher–Yates) driven by `random`. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }
  return copy;
}
