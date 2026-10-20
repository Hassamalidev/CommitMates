import { findLinks } from '@commitmates/algorithms';

import { chatCopy } from '@/copy/chat';

/** A message as the conversation page draws it; dates travel as ISO strings. */
export type ChatMessage = {
  id: string;
  authorUserId: string | null;
  kind: 'user' | 'system';
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

/**
 * A Postgres `timestamptz` as text (`2026-10-21 10:00:00.123456+00` or ISO with microseconds), as an
 * ISO string with milliseconds; null when it cannot be read.
 */
export function parseTimestamp(value: string): string | null {
  const normalized = value
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A row from the database or a Realtime payload, as a `ChatMessage`; null when it is not one. */
export function toChatMessage(row: Record<string, unknown>): ChatMessage | null {
  const { id, kind, body } = row;
  const createdAt = row.createdAt ?? row.created_at;
  const authorUserId = row.authorUserId ?? row.author_user_id ?? null;
  const editedAt = row.editedAt ?? row.edited_at ?? null;
  const deletedAt = row.deletedAt ?? row.deleted_at ?? null;
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? parseTimestamp(value) : null);
  if (typeof id !== 'string' || (kind !== 'user' && kind !== 'system') || typeof body !== 'string') return null;
  const created = iso(createdAt);
  if (created === null || (authorUserId !== null && typeof authorUserId !== 'string')) return null;
  return { id, authorUserId, kind, body, createdAt: created, editedAt: iso(editedAt), deletedAt: iso(deletedAt) };
}

/** When a message last changed: sent, edited or deleted. */
const changedAt = (message: ChatMessage) => [message.createdAt, message.editedAt ?? '', message.deletedAt ?? ''].sort().at(-1) ?? message.createdAt;

/** Merges server pages and live updates by id, oldest first; the most recently changed version of a message wins. */
export function mergeMessages(...lists: readonly (readonly ChatMessage[])[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const list of lists) {
    for (const message of list) {
      const known = byId.get(message.id);
      if (!known || changedAt(message) >= changedAt(known)) byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export type TextPart = { text: string } | { href: string; text: string };

/** Characters that usually end a sentence rather than a link. */
const TRAILING = /[.,!?;:)\]'"]+$/;

/**
 * Splits plain text into text and links (CLAUDE.md §8 F12 "Messages": plain text with auto-linked
 * URLs, no HTML). Only `http(s)://` and `www.` links become anchors; `www.` gets `https://`.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let rest = text;
  for (const found of findLinks(text)) {
    const link = found.replace(TRAILING, '');
    const at = rest.indexOf(link);
    if (at < 0 || link === '') continue;
    if (at > 0) parts.push({ text: rest.slice(0, at) });
    parts.push({ href: link.toLowerCase().startsWith('www.') ? `https://${link}` : link, text: link });
    rest = rest.slice(at + link.length);
  }
  if (rest !== '') parts.push({ text: rest });
  return parts;
}

/** The words for a system message, which the database stores as a key. */
export function systemNoteText(body: string): string {
  const copy = chatCopy.conversation.system;
  if (body === 'member_left') return copy.memberLeft;
  if (body.startsWith('left:')) return copy.left(body.slice('left:'.length));
  return copy.memberLeft;
}

/** "Oct 21, 14:05" in the member's timezone. */
export function formatMessageTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}
