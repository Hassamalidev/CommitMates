'use client';

import { Button, Textarea } from '@commitmates/ui';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { ReportDialog } from '@/components/safety/ReportDialog';
import { chatCopy } from '@/copy/chat';
import { safetyCopy } from '@/copy/safety';
import {
  formatMessageTime,
  linkify,
  mergeMessages,
  systemNoteText,
  toChatMessage,
  type ChatMessage,
} from '@/lib/chat';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { ActionResult } from '@/server/action';
import {
  deleteMessageAction,
  editMessageAction,
  markReadAction,
  sendMessageAction,
} from '@/server/actions/chat';

type Person = { login: string; name: string | null };

export type ConversationViewProps = {
  threadId: string;
  meId: string;
  people: Readonly<Record<string, Person>>;
  messages: readonly ChatMessage[];
  editWindowMinutes: number;
  maxChars: number;
  timeZone: string;
  /** Whether this is the latest page; live updates only join the latest page. */
  latest: boolean;
  /** Longest details text on a report about a message. */
  reportDetailsMax: number;
};

/** How often the edit buttons are re-checked against the edit window. */
const CLOCK_TICK_MS = 30_000;
const MS_PER_MINUTE = 60_000;

/** Plain text with auto-linked URLs; nothing in a message is ever read as HTML (CLAUDE.md §8 F12). */
function MessageText({ body }: { body: string }) {
  return (
    <p className="type-body break-words whitespace-pre-wrap">
      {linkify(body).map((part, index) =>
        'href' in part ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-fg underline"
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function EditForm({
  message,
  maxChars,
  onDone,
}: {
  message: ChatMessage;
  maxChars: number;
  onDone: () => void;
}) {
  const copy = chatCopy.conversation;
  const [result, action, pending] = useActionState(
    async (previous: ActionResult<null> | null, formData: FormData) => {
      const outcome = await editMessageAction(previous, formData);
      if (outcome.ok) onDone();
      return outcome;
    },
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="messageId" value={message.id} />
      <Textarea
        label={copy.editLabel}
        name="body"
        defaultValue={message.body}
        maxLength={maxChars}
        required
        rows={3}
        error={result && !result.ok ? result.error.message : undefined}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {copy.save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * A conversation (CLAUDE.md §8 F12 "Messages", "Realtime"): messages arrive through Supabase Realtime
 * (Row Level Security limits them to the member's threads), the member's own messages can be edited
 * within the edit window and deleted, and the thread is marked read as messages arrive.
 */
export function ConversationView({
  threadId,
  meId,
  people,
  messages,
  editWindowMinutes,
  maxChars,
  timeZone,
  latest,
  reportDetailsMax,
}: ConversationViewProps) {
  const copy = chatCopy.conversation;
  const [reporting, setReporting] = useState<{ messageId: string; userId: string; login: string } | null>(null);
  const [reported, setReported] = useState(false);
  const [live, setLive] = useState<ChatMessage[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [sent, sendAction, sending] = useActionState(
    async (previous: Awaited<ReturnType<typeof sendMessageAction>> | null, formData: FormData) => {
      const outcome = await sendMessageAction(previous, formData);
      // The field empties after a send; a refused message stays for the member to fix.
      if (outcome.ok) setDraft('');
      return outcome;
    },
    null,
  );
  const [deleted, deleteAction] = useActionState(deleteMessageAction, null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () => (latest ? mergeMessages(messages, live) : [...messages]),
    [latest, messages, live],
  );

  // The edit window is judged by the browser's clock once it is known (never during server render).
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, CLOCK_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!latest) return;
    const supabase = createSupabaseBrowserClient();
    let active = true;
    const channel = supabase.channel(`thread:${threadId}`);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload) => {
        const row = toChatMessage(payload.new);
        if (!row) return;
        setLive((previous) => [...previous.filter((message) => message.id !== row.id), row]);
        if (row.authorUserId !== meId) void markReadAction(threadId);
      },
    );
    // Subscribe with the member's own token, so Row Level Security decides what arrives.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [threadId, meId, latest]);

  // Keep the newest message in view as messages arrive.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown.length]);

  const author = (message: ChatMessage) => {
    if (message.authorUserId === meId) return chatCopy.inbox.you;
    const person = message.authorUserId ? people[message.authorUserId] : undefined;
    return person ? (person.name ?? `@${person.login}`) : '';
  };
  const editable = (message: ChatMessage) =>
    now !== null && now - new Date(message.createdAt).getTime() <= editWindowMinutes * MS_PER_MINUTE;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={listRef}
        role="log"
        aria-label={copy.listLabel}
        className="max-h-[60dvh] overflow-y-auto rounded-card border border-line bg-surface p-3 sm:p-4"
      >
        <ol className="flex flex-col gap-3">
          {shown.map((message) =>
            message.kind === 'system' ? (
              <li key={message.id} className="type-small text-center text-fg-muted">
                {systemNoteText(message.body)}
              </li>
            ) : (
              <li
                key={message.id}
                className={
                  message.authorUserId === meId
                    ? 'ml-auto flex max-w-[85%] flex-col gap-1 rounded-card bg-surface-2 p-3'
                    : 'mr-auto flex max-w-[85%] flex-col gap-1 rounded-card border border-line p-3'
                }
              >
                <p className="type-small text-fg-muted">
                  <span className="font-semibold text-fg">{author(message)}</span> ·{' '}
                  <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt, timeZone)}</time>
                  {message.editedAt && !message.deletedAt ? ` · ${copy.edited}` : null}
                </p>
                {message.deletedAt ? (
                  <p className="type-body text-fg-muted italic">{copy.deleted}</p>
                ) : editing === message.id ? (
                  <EditForm
                    message={message}
                    maxChars={maxChars}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                ) : (
                  <MessageText body={message.body} />
                )}
                {message.authorUserId === meId && !message.deletedAt && editing !== message.id ? (
                  <div className="flex gap-1">
                    {editable(message) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(message.id);
                        }}
                      >
                        {copy.edit}
                      </Button>
                    ) : null}
                    <form action={deleteAction}>
                      <input type="hidden" name="messageId" value={message.id} />
                      <input type="hidden" name="threadId" value={threadId} />
                      <Button type="submit" size="sm" variant="ghost">
                        {copy.delete}
                      </Button>
                    </form>
                  </div>
                ) : null}
                {message.authorUserId !== meId && message.authorUserId !== null && !message.deletedAt ? (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const authorId = message.authorUserId;
                        const person = authorId ? people[authorId] : undefined;
                        if (authorId && person) setReporting({ messageId: message.id, userId: authorId, login: person.login });
                      }}
                    >
                      {safetyCopy.report.messageButton}
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ol>
      </div>
      {reported ? (
        <p role="status" className="type-small text-state-done">
          {safetyCopy.report.done}
        </p>
      ) : null}
      {reporting ? (
        <ReportDialog
          targetUserId={reporting.userId}
          login={reporting.login}
          messageId={reporting.messageId}
          detailsMax={reportDetailsMax}
          onClose={() => {
            setReporting(null);
          }}
          onSent={() => {
            setReporting(null);
            setReported(true);
          }}
        />
      ) : null}
      {deleted && !deleted.ok ? (
        <p role="alert" className="type-small text-state-error">
          {deleted.error.message}
        </p>
      ) : null}
      {latest ? (
        <form action={sendAction} className="flex flex-col gap-2">
          <input type="hidden" name="threadId" value={threadId} />
          <Textarea
            label={copy.composerLabel}
            name="body"
            required
            maxLength={maxChars}
            rows={3}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            description={copy.composerHelp(maxChars)}
            error={sent && !sent.ok ? sent.error.message : undefined}
          />
          <Button type="submit" loading={sending} className="self-start">
            {copy.send}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
