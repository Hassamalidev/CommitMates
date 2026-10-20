/**
 * Links in a chat message.
 * Rule: a link is an `http://` or `https://` URL, or a bare `www.` host, up to the next whitespace.
 * Settings: chat.maxLinksNewAccount (compared by the caller)
 * Spec: CLAUDE.md §8 F12 "Messages"
 */

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** The links in a message, in order. */
export function findLinks(text: string): string[] {
  return text.match(LINK) ?? [];
}

/** How many links a message contains. */
export function countLinks(text: string): number {
  return findLinks(text).length;
}
