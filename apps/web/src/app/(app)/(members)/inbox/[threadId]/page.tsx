import {
  NotFoundError,
  getConversation,
  getSetting,
  isBlocking,
  streakStatusInThread,
} from '@commitmates/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { ConversationView } from '@/components/chat/ConversationView';
import { ThreadActions } from '@/components/chat/ThreadActions';
import { ActionForm } from '@/components/forms/ActionForm';
import { SafetyActions } from '@/components/safety/SafetyActions';
import { chatCopy } from '@/copy/chat';
import { streaksCopy } from '@/copy/streaks';
import { toChatMessage, type ChatMessage } from '@/lib/chat';
import { invitePairAction } from '@/server/actions/streaks';
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
  return {
    title: chatCopy.conversation.meta.title(others.map(nameOf).join(', ') || chatCopy.conversation.alone),
    robots: { index: false },
  };
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
  const people = Object.fromEntries(
    conversation.members.map((person) => [person.userId, { login: person.login, name: person.name }]),
  );
  const earlier = conversation.before
    ? `/inbox/${threadId}?before=${encodeURIComponent(conversation.before.createdAt)}&id=${encodeURIComponent(conversation.before.id)}`
    : null;
  const latest = conversation.latest;
  // In a direct conversation the other person can be blocked or reported from here (§8 F12).
  const partner = conversation.thread.kind === 'direct' && others.length === 1 ? others[0] : undefined;
  const [blocked, detailsMax, streak] = await Promise.all([
    partner ? isBlocking(member, partner.userId) : false,
    getSetting('safety.reportDetailsMaxChars'),
    partner ? streakStatusInThread(member, threadId) : null,
  ]);

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-4 px-4 py-10">
      <Link href="/inbox" className="type-small text-fg-muted underline">
        {copy.back}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="type-h1 break-words">
            {conversation.thread.title ?? (others.map(nameOf).join(', ') || copy.alone)}
          </h1>
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
        <div className="flex flex-col items-end gap-2">
          <ThreadActions threadId={threadId} muted={me?.muted ?? false} />
          {partner ? (
            <SafetyActions
              userId={partner.userId}
              login={partner.login}
              blocked={blocked}
              detailsMax={detailsMax}
            />
          ) : null}
        </div>
      </header>
      {streak ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-3">
          {streak.state === 'none' && !blocked ? (
            <ActionForm
              action={invitePairAction}
              values={{ threadId }}
              submitLabel={streaksCopy.thread.start}
              successMessage={streaksCopy.thread.invited}
            />
          ) : streak.state === 'none' ? null : (
            <>
              <p className="type-small">{streaksCopy.thread[streak.state]}</p>
              <Link href="/streaks" className="type-small underline">
                {streaksCopy.thread.view}
              </Link>
            </>
          )}
        </div>
      ) : null}
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
        reportDetailsMax={detailsMax}
      />
    </div>
  );
}
