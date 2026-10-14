/**
 * Shannon entropy of a string.
 * Formula: H = −Σ p(c)·log2 p(c) over the distinct characters c, p(c) = count(c) / length
 * Settings: none (thresholds come per rule from gitleaks)
 * Spec: CLAUDE.md §6.7, §8 F3 "Secret scan"
 */

/** Bits of entropy per character; 0 for an empty string or a single repeated character. */
export function shannonEntropy(text: string): number {
  // Code points, not UTF-16 units: an emoji is one character.
  const characters = Array.from(text);
  if (characters.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of characters) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / characters.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
