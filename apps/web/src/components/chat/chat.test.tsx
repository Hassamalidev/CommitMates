// @vitest-environment jsdom
import { findA11yViolations } from '@commitmates/config/testing/axe';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linkify, mergeMessages, parseTimestamp, systemNoteText, toChatMessage, type ChatMessage } from '@/lib/chat';
import type { ActionResult } from '@/server/action';

type Handler = (payload: { new: Record<string, unknown> }) => void;
const channel = { handler: null as Handler | null, subscribed: false, filter: '' };
const removeChannel = vi.fn();
const setAuth = vi.fn();
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'member-token' } } }) },
    realtime: { setAuth },
    removeChannel,
    channel: () => {
      const api = {
        on: (_event: string, options: { filter: string }, handler: Handler) => {
          channel.handler = handler;
          channel.filter = options.filter;
          return api;
        },
        subscribe: () => {
          channel.subscribed = true;
          return api;
        },
      };
      return api;
    },
  }),
}));
const sendMessageAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<{ id: string; createdAt: string }>>>();
const editMessageAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<null>>>();
const deleteMessageAction = vi.fn<(previous: unknown, formData: FormData) => Promise<ActionResult<null>>>();
const markReadAction = vi.fn<(threadId: string) => Promise<ActionResult<null>>>();
vi.mock('@/server/actions/chat', () => ({ sendMessageAction, editMessageAction, deleteMessageAction, markReadAction }));

const { ConversationView } = await import('./ConversationView');

const message = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  authorUserId: 'them',
  kind: 'user',
  body: `message ${id}`,
  createdAt: '2026-10-21T10:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  ...overrides,
});

describe('chat helpers', () => {
  it('links http, https and www addresses without trailing punctuation, and nothing else', () => {
    expect(linkify('See https://github.com/a/b. Or www.example.org, and <b>bold</b>!')).toEqual([
      { text: 'See ' },
      { href: 'https://github.com/a/b', text: 'https://github.com/a/b' },
      { text: '. Or ' },
      { href: 'https://www.example.org', text: 'www.example.org' },
      { text: ', and <b>bold</b>!' },
    ]);
    expect(linkify('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });

  it('reads Postgres timestamps and database rows', () => {
    expect(parseTimestamp('2026-10-21 10:00:00.123456+00')).toBe('2026-10-21T10:00:00.123Z');
    expect(parseTimestamp('2026-10-21T10:00:00.5+05:00')).toBe('2026-10-21T05:00:00.500Z');
    expect(parseTimestamp('soon')).toBeNull();
    expect(toChatMessage({ id: 'm', author_user_id: null, kind: 'system', body: 'member_left', created_at: '2026-10-21 10:00:00+00' })).toEqual({
      id: 'm',
      authorUserId: null,
      kind: 'system',
      body: 'member_left',
      createdAt: '2026-10-21T10:00:00.000Z',
      editedAt: null,
      deletedAt: null,
    });
    expect(toChatMessage({ id: 'm', kind: 'other', body: '', created_at: '2026-10-21' })).toBeNull();
  });

  it('merges pages and live updates, keeping the latest version of each message', () => {
    const first = message('a', { createdAt: '2026-10-21T10:00:00.000Z' });
    const edited = { ...first, body: 'edited', editedAt: '2026-10-21T10:05:00.000Z' };
    const later = message('b', { createdAt: '2026-10-21T10:01:00.000Z' });
    expect(mergeMessages([edited, later], [first]).map((entry) => entry.body)).toEqual(['edited', 'message b']);
  });

  it('writes system notes from their keys', () => {
    expect(systemNoteText('member_left')).toBe('A member left this conversation.');
    expect(systemNoteText('left:sam')).toBe('@sam left this conversation.');
  });
});

describe('ConversationView', () => {
  beforeEach(() => {
    channel.handler = null;
    channel.subscribed = false;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const props = {
    threadId: 'thread-1',
    meId: 'me',
    people: { me: { login: 'me', name: null }, them: { login: 'sam', name: 'Sam Rivera' } },
    messages: [message('1', { body: 'Hi, see https://github.com/x/y' }), message('2', { authorUserId: 'me', body: 'Hello!', createdAt: '2026-10-21T10:01:00.000Z' })],
    editWindowMinutes: 10,
    maxChars: 4000,
    timeZone: 'UTC',
    latest: true,
  };

  it('shows the messages with links, subscribes with the member’s token, and adds live messages', async () => {
    render(
      <main>
        <ConversationView {...props} />
      </main>,
    );
    expect(screen.getByRole('link', { name: 'https://github.com/x/y' }).getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(screen.getByText('Sam Rivera')).toBeTruthy();
    await waitFor(() => {
      expect(channel.subscribed).toBe(true);
    });
    expect(setAuth).toHaveBeenCalledWith('member-token');
    expect(channel.filter).toBe('thread_id=eq.thread-1');
    expect(await findA11yViolations(document.body)).toEqual([]);

    act(() => {
      channel.handler?.({ new: { id: '3', author_user_id: 'them', kind: 'user', body: 'Arrived live', created_at: '2026-10-21 10:02:00+00', edited_at: null, deleted_at: null } });
    });
    expect(await screen.findByText('Arrived live')).toBeTruthy();
    expect(markReadAction).toHaveBeenCalledWith('thread-1');
    // A deletion arrives as an update.
    act(() => {
      channel.handler?.({ new: { id: '3', author_user_id: 'them', kind: 'user', body: '', created_at: '2026-10-21 10:02:00+00', deleted_at: '2026-10-21 10:03:00+00' } });
    });
    expect(await screen.findByText('This message was deleted.')).toBeTruthy();
  });

  it('sends a message, empties the field, and keeps the text when it is refused', async () => {
    sendMessageAction
      .mockResolvedValueOnce({ ok: false, error: { code: 'chat.unreachable', message: "You can't message this person right now." } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'new', createdAt: '2026-10-21T10:03:00.000Z' } });
    render(<ConversationView {...props} />);
    const box = screen.getByLabelText<HTMLTextAreaElement>('Message');
    fireEvent.change(box, { target: { value: 'Are you around?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("You can't message this person right now.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe('Are you around?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe('');
    });
    expect(sendMessageAction.mock.calls[1]?.[1].get('threadId')).toBe('thread-1');
  });

  it('offers Edit only within the edit window, and Delete on the member’s own messages', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:05:00.000Z'));
    render(<ConversationView {...props} />);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    cleanup();
    vi.setSystemTime(new Date('2026-10-21T10:30:00.000Z'));
    render(<ConversationView {...props} />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    vi.useRealTimers();
  });

  it('leaves an older page alone: no live updates and no composer', () => {
    render(<ConversationView {...props} latest={false} />);
    expect(channel.subscribed).toBe(false);
    expect(screen.queryByLabelText('Message')).toBeNull();
  });
});
