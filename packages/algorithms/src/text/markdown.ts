/**
 * README excerpts as plain text.
 * Formula: drop fenced code, HTML, images and link targets; keep link text; drop heading, quote,
 *   list and emphasis markers; keep paragraphs; cut at the last word boundary before `maxChars`
 *   and add an ellipsis. The result is text, never markup, so it can be shown without sanitizing.
 * Settings: legacy.excerptChars (passed in)
 * Spec: CLAUDE.md §8 F17 "UI" (README excerpt, sanitized)
 */

const ELLIPSIS = '…';

/** Markdown reduced to readable text, paragraphs separated by a blank line. */
export function markdownToText(markdown: string): string {
  const text = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|[^\w])(\*\*|__)(.*?)\2(?=[^\w]|$)/gm, '$1$3')
    .replace(/(^|[^\w])(\*|_)(\S(?:.*?\S)?)\2(?=[^\w]|$)/gm, '$1$3');
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

/** The start of a README as plain text, at most `maxChars` characters (§8 F17). */
export function markdownExcerpt(markdown: string, maxChars: number): string {
  const text = markdownToText(markdown);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - ELLIPSIS.length));
  const boundary = cut.search(/\s\S*$/);
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}${ELLIPSIS}`;
}
