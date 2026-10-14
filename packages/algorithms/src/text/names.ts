/**
 * Name normalization for deduplication.
 * Formula: Unicode NFKD, accents removed, lowercased, every run of non-letters/digits → one space, trimmed.
 *   "Computer Science & Engineering" and "computer-science  engineering" normalize alike.
 * Settings: none
 * Spec: CLAUDE.md §8 F10 step 7 (departments deduplicated by normalized name)
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
