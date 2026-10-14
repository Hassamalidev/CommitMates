/**
 * Email domains and their suffixes.
 * Formula: the suffixes of `a.b.c.d` at label boundaries, longest first: `a.b.c.d`, `b.c.d`, `c.d`.
 *   A single label (a top-level domain) is never a candidate, so `edu` cannot match everything.
 * Settings: none
 * Spec: CLAUDE.md §6.4 "Matching rule", §8 F10 step 2
 */

/** A hostname label: letters, digits and inner hyphens (RFC 1035; punycode labels pass). */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A registrable domain has at least a name and a top-level label; a bare TLD never matches. */
const MIN_LABELS = 2;

/** Lowercased, trimmed domain without a trailing dot, or `null` when it is not a hostname. */
export function normalizeDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  const labels = domain.split('.');
  if (labels.length < MIN_LABELS || !labels.every((label) => LABEL.test(label))) return null;
  return domain;
}

/** The domain part of an email address, normalized; `null` for anything else. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return normalizeDomain(trimmed.slice(at + 1));
}

/** Every suffix of a domain at a label boundary with at least two labels, longest first. */
export function domainSuffixes(domain: string): string[] {
  const normalized = normalizeDomain(domain);
  if (normalized === null) return [];
  const labels = normalized.split('.');
  const suffixes: string[] = [];
  for (let start = 0; start <= labels.length - MIN_LABELS; start += 1) suffixes.push(labels.slice(start).join('.'));
  return suffixes;
}
