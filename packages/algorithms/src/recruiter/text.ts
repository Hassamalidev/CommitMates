/**
 * Text signals for profile audits: commit messages, unfinished projects and demo links.
 * Formula: a commit message is normalized (first line, lowercase, issue references removed,
 *            whitespace collapsed); it is informative when it has at least `minTokens` words
 *            and is not one of the most common short messages;
 *          a README signals "unfinished" when it contains an unfinished term as a whole word
 *            or an unchecked task (`- [ ]`); unfinished score = mean of the signals that apply
 * Settings: recruiter.minMessageTokens, recruiter.genericMessageTopK, graveyard.unfinishedTerms
 * Spec: CLAUDE.md §8 F3 "Informative commit message", §8 F7 step 5
 */

const ISSUE_REFERENCE = /(?:\b(?:gh-|issue\s*))?#\d+\b|\bgh-\d+\b/gi;
/** Brackets left empty once a reference is removed, e.g. `(#12)`. */
const EMPTY_BRACKETS = /\(\s*\)|\[\s*\]/g;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;
const UNCHECKED_TASK = /^\s*[-*+]\s+\[ \]\s+/m;
/** Markdown links and bare URLs; images (`![…](…)`) are not links to anything. */
const LINK = /(?<!!)\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?:^|\s)(https?:\/\/[^\s)<>\]]+)/gi;
/** Hosts that are GitHub itself: a link there is code, not a running demo. GitHub Pages (`github.io`) is a demo. */
const GITHUB_HOST = /(?:^|\.)(?:github\.com|githubusercontent\.com|githubassets\.com)$/i;

/** The subject line of a commit message, normalized for comparison. */
export function normalizeCommitMessage(message: string): string {
  const subject = message.split(/\r?\n/, 1)[0] ?? '';
  return subject.toLowerCase().replace(ISSUE_REFERENCE, ' ').replace(EMPTY_BRACKETS, ' ').replace(/\s+/g, ' ').trim();
}

/** Words in a normalized message. */
export const messageTokens = (normalized: string): string[] => normalized.match(WORD) ?? [];

/** True when a commit message says something: enough words, and not one of the generic ones. */
export function isInformativeMessage(message: string, minTokens: number, generic: ReadonlySet<string>): boolean {
  const normalized = normalizeCommitMessage(message);
  return messageTokens(normalized).length >= minTokens && !generic.has(normalized);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A matcher for any of the terms as whole words, case-insensitively. `null` without terms. */
export function termMatcher(terms: readonly string[]): RegExp | null {
  const cleaned = terms.map((term) => term.trim()).filter((term) => term !== '');
  if (cleaned.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${cleaned.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/** 1 when a README says the project is unfinished (a term, or an unchecked task), else 0. */
export function readmeUnfinishedSignal(readme: string, terms: RegExp | null): number {
  return (terms?.test(readme) ?? false) || UNCHECKED_TASK.test(readme) ? 1 : 0;
}

/** Share of commit messages that mention an unfinished term; `null` without messages. */
export function commitUnfinishedSignal(messages: readonly string[], terms: RegExp | null): number | null {
  if (messages.length === 0) return null;
  if (terms === null) return 0;
  return messages.filter((message) => terms.test(message)).length / messages.length;
}

/** Mean of the signals that apply (`null` ones are left out); `null` when none applies. */
export function unfinishedScore(signals: readonly (number | null)[]): number | null {
  const applicable = signals.filter((signal): signal is number => signal !== null);
  if (applicable.length === 0) return null;
  return applicable.reduce((total, signal) => total + signal, 0) / applicable.length;
}

/** True when a README links to an http(s) address outside GitHub: a live demo or site. */
export function hasExternalLink(readme: string): boolean {
  for (const match of readme.matchAll(LINK)) {
    // The three alternatives of LINK capture the address in groups 1, 2 and 3.
    const [, inline, angled, bare] = match;
    const url = inline ?? angled ?? bare;
    if (!url) continue;
    try {
      if (!GITHUB_HOST.test(new URL(url).hostname)) return true;
    } catch {
      // Not a URL after all.
    }
  }
  return false;
}
