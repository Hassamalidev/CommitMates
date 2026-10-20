import { NotFoundError, getConversation } from '@commitmates/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { ConversationView } from '@/components/chat/ConversationView';
import { ThreadActions } from '@/components/chat/ThreadActions';
import { chatCopy } from '@/copy/chat';
import { toChatMessage, type ChatMessage } from '@/lib/chat';
import { getCurrentMember } from '@/server/auth';

type Props = {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ before?: string | string[]; id?: string | string[] }>;
};

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

/** The conversation, or null when the member is not in it (which looks the same as a missing one). */
const load = cache(async (threadId: string, before: string | undefined, beforeId: string | undefined) => {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/inbox');
  try {
    const cursor = before && beforeId ? { createdAt: before, id: beforeId } : null;
    return { member, conversation: await getConversation(member, threadId, cursor) };
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
});

const nameOf = (person: { login: string; name: string | null }) => person.name ?? `@${person.login}`;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { before, id } = await searchParams;
  const loaded = await load((await params).threadId, one(before), one(id));
  if (!loaded) return { robots: { index: false } };
  const others = loaded.conversation.members.filter((person) => person.userId !== loaded.member.id);
  return { title: chatCopy.conversation.meta.title(others.map(nameOf).join(', ') || chatCopy.conversation.alone), robots: { index: false } };
}

/** One conversation (CLAUDE.md §8 F12): its messages, live updates, and the member's own controls. */
export default async function ConversationPage({ params, searchParams }: Props) {
  const { threadId } = await params;
  const { before, id } = await searchParams;
  const loaded = await load(threadId, one(before), one(id));
  if (!loaded) notFound();
  const { member, conversation } = loaded;
  const copy = chatCopy.conversation;
  const others = conversation.members.filter((person) => person.userId !== member.id);
  const me = conversation.members.find((person) => person.userId === member.id);
  const messages = conversation.messages.flatMap((message): ChatMessage[] => {
    const parsed = toChatMessage(message);
    return parsed ? [parsed] : [];
  });
  const people = Object.fromEntries(conversation.members.map((person) => [person.userId, { login: person.login, name: person.name }]));
  const earlier = conversation.before
    ? `/inbox/${threadId}?before=${encodeURIComponent(conversation.before.createdAt)}&id=${encodeURIComponent(conversation.before.id)}`
    : null;
  const latest = conversation.latest;

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-4 px-4 py-10">
      <Link href="/inbox" className="type-small text-fg-muted underline">
        {copy.back}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="type-h1 break-words">{conversation.thread.title ?? (others.map(nameOf).join(', ') || copy.alone)}</h1>
          <ul className="type-small mt-1 flex flex-wrap gap-x-3">
            {others.map((person) => (
              <li key={person.userId}>
                <Link href={`/u/${encodeURIComponent(person.login)}`} className="text-fg-muted underline">
                  {copy.profile(person.login)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <ThreadActions threadId={threadId} muted={me?.muted ?? false} />
      </header>
      {earlier ? (
        <Link href={earlier} className="type-small self-center underline">
          {copy.earlier}
        </Link>
      ) : null}
      {latest ? (
        <p className="type-small text-fg-muted">{copy.live}</p>
      ) : (
        <Link href={`/inbox/${threadId}`} className="type-small self-center underline">
          {copy.latest}
        </Link>
      )}
      <ConversationView
        threadId={threadId}
        meId={member.id}
        people={people}
        messages={messages}
        editWindowMinutes={conversation.editWindowMinutes}
        maxChars={conversation.maxChars}
        timeZone={member.timezone}
        latest={latest}
      />
    </div>
  );
}
