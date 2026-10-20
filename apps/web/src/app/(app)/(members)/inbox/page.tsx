import { getInbox } from '@commitmates/core';
import { Card, Chip, CompanionView, EmptyState, StateChip, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RespondForm } from '@/components/chat/RespondForm';
import { chatCopy } from '@/copy/chat';
import { brandCompanion } from '@/lib/brand';
import { formatMessageTime, systemNoteText } from '@/lib/chat';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: chatCopy.inbox.meta.title, robots: { index: false } };
}

const STATUS_STATE = { pending: 'waiting', accepted: 'done', expired: 'idle' } as const;
/** Characters of the last message shown in the list. */
const PREVIEW_CHARS = 120;

const preview = (body: string) => (body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body);

/**
 * The inbox (CLAUDE.md §8 F12): requests waiting for the member with their context, requests the
 * member sent, and conversations with unread counts.
 */
export default async function InboxPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/inbox');
  const inbox = await getInbox(member);
  const copy = chatCopy.inbox;
  const name = (person: { login: string; name: string | null }) => person.name ?? `@${person.login}`;

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <header>
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 mt-1">{copy.title}</h1>
        <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="threads-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="threads-title" className="type-h2">
            {copy.threadsTitle}
          </h2>
          {inbox.threads.length === 0 ? (
            <EmptyState
              companion={<CompanionView companion={brandCompanion} state="idle" size={96} label={copy.threadsTitle} />}
              title={copy.threadsEmpty.title}
              description={copy.threadsEmpty.line}
              action={
                <Link href="/discover" className={buttonStyles({ variant: 'secondary', size: 'md' })}>
                  {copy.discoverLink}
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {inbox.threads.map((thread) => {
                const title = thread.title ?? (thread.others.map(name).join(', ') || chatCopy.conversation.alone);
                const last = thread.lastMessage;
                return (
                  <li key={thread.id}>
                    <Link
                      href={`/inbox/${thread.id}`}
                      className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:border-line-strong"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="type-h3 min-w-0 break-words">{title}</span>
                        {thread.unread > 0 && !thread.muted ? <Chip className="font-semibold">{copy.unread(thread.unread)}</Chip> : null}
                        {thread.muted ? <Chip>{copy.muted}</Chip> : null}
                      </span>
                      <span className="type-small break-words text-fg-muted">
                        {last === null
                          ? copy.noMessages
                          : last.kind === 'system'
                            ? systemNoteText(last.body)
                            : `${last.authorUserId === member.id ? `${copy.you}: ` : ''}${last.deleted ? copy.deleted : preview(last.body)}`}
                      </span>
                      {last ? (
                        <time className="type-small text-fg-muted" dateTime={last.createdAt.toISOString()}>
                          {formatMessageTime(last.createdAt.toISOString(), member.timezone)}
                        </time>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          <Card title={copy.incomingTitle} titleAs="h2" className="flex flex-col gap-3">
            {inbox.incoming.length === 0 ? (
              <p className="type-small text-fg-muted">{copy.incomingEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {inbox.incoming.map((request) => (
                  <li key={request.id} className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
                    <p className="type-small">
                      <Link href={`/u/${encodeURIComponent(request.from.login)}`} className="font-semibold underline">
                        {name(request.from)}
                      </Link>{' '}
                      <span className="text-fg-muted">· {copy.context[request.contextKind] ?? ''}</span>
                    </p>
                    <p className="type-body break-words whitespace-pre-wrap">{request.firstMessage}</p>
                    <RespondForm requestId={request.id} login={request.from.login} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={copy.outgoingTitle} titleAs="h2" className="flex flex-col gap-3">
            {inbox.outgoing.length === 0 ? (
              <p className="type-small text-fg-muted">{copy.outgoingEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {inbox.outgoing.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="type-small min-w-0 break-words">{name(request.to)}</span>
                    <StateChip state={STATUS_STATE[request.status]} label={copy.status[request.status]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
