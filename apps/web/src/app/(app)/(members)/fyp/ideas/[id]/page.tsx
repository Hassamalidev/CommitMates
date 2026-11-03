import { getIdea, getSetting } from '@commitmates/core';
import { Card, Chip, EmptyState, StateChip, Textarea } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { MatchList } from '@/components/fyp/IdeaComposer';
import { ActionForm } from '@/components/forms/ActionForm';
import { fypBoardCopy } from '@/copy/fyp-board';
import { expressInterestAction, pickTeamAction, setIdeaStatusAction, withdrawInterestAction } from '@/server/actions/fyp-board';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: fypBoardCopy.meta.title, robots: { index: false } };
}

const copy = fypBoardCopy;
const STATUS_STATE = { open: 'idle', team_forming: 'working', taken: 'done', archived: 'idle' } as const;

type Props = { params: Promise<{ id: string }> };

/** One idea (CLAUDE.md §8 F22): its duplicate-check summary, asking to join, and the author's team controls. */
export default async function FypIdeaPage({ params }: Props) {
  const member = await getCurrentMember();
  const { id } = await params;
  if (!member) redirect(`/auth/sign-in?next=/fyp/ideas/${id}`);
  const detail = await getIdea(member, id).catch(() => null);
  if (!detail) notFound();
  const { idea } = detail;
  const values = { ideaId: idea.id };
  const lookingForTeam = idea.status === 'open' || idea.status === 'team_forming';
  const maxMessage = await getSetting('fyp.interestMaxChars');

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      <Link href="/fyp" className="type-small inline-flex min-h-11 items-center self-start underline">
        {copy.idea.back}
      </Link>
      <header className="flex flex-col gap-2">
        <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
        <h1 className="type-h1 break-words">{idea.title}</h1>
        <p className="type-small text-fg-muted">
          {copy.ideas.by(detail.authorLogin)}
          {idea.supervisorIdea ? ` · ${copy.ideas.supervisorIdea}` : ''}
        </p>
        <StateChip state={STATUS_STATE[idea.status]} label={copy.status[idea.status]} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <p className="type-body break-words whitespace-pre-line">{idea.description}</p>
            {idea.keyphrases.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label={copy.post.keyphrases}>
                {idea.keyphrases.map((phrase) => (
                  <li key={phrase}>
                    <Chip>{phrase}</Chip>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <section aria-labelledby="summary-title" className="flex flex-col gap-2">
            <h2 id="summary-title" className="type-h2">
              {copy.idea.summary}
            </h2>
            {detail.university === null ? <p className="type-small text-fg-muted">{copy.idea.noSummary}</p> : <MatchList matches={detail.university} label={copy.idea.summary} />}
          </section>
        </div>

        <aside className="flex flex-col gap-4" aria-label={copy.idea.interestTitle}>
          {detail.threadId ? (
            <Link href={`/inbox/${detail.threadId}`} className="type-small text-accent underline underline-offset-4">
              {copy.idea.conversation}
            </Link>
          ) : null}

          {!detail.isAuthor ? (
            <Card title={copy.idea.interestTitle} titleAs="h2" className="flex flex-col gap-3">
              {!lookingForTeam ? <p className="type-small">{copy.idea.closed}</p> : null}
              {detail.myInterest ? (
                <>
                  <p className="type-small break-words">{copy.idea.yourMessage(detail.myInterest)}</p>
                  <ActionForm action={withdrawInterestAction} values={values} submitLabel={copy.idea.withdraw} variant="ghost" />
                </>
              ) : lookingForTeam ? (
                <ActionForm action={expressInterestAction} values={values} submitLabel={copy.idea.send} successMessage={copy.idea.sent} variant="primary" className="flex flex-col items-start gap-2">
                  <Textarea label={copy.idea.message} name="message" rows={3} maxLength={maxMessage} description={copy.idea.messageHelp(maxMessage)} required className="w-full" />
                </ActionForm>
              ) : null}
            </Card>
          ) : (
            <Card title={copy.idea.interestedTitle} titleAs="h2" className="flex flex-col gap-3">
              {detail.interest === null || detail.interest.length === 0 ? (
                <EmptyState title={copy.idea.interestedTitle} description={copy.idea.noInterest} />
              ) : idea.threadId === null && idea.status === 'open' ? (
                <ActionForm action={pickTeamAction} values={values} submitLabel={copy.idea.pickTeam} variant="primary" className="flex flex-col items-start gap-3">
                  <fieldset className="flex flex-col gap-2">
                    <legend className="type-small mb-1 font-semibold">{copy.idea.interestedTitle}</legend>
                    {detail.interest.map((entry) => (
                      <div key={entry.userId} className="type-small flex min-h-11 items-start gap-2">
                        <input id={`pick-${entry.userId}`} type="checkbox" name="userId" value={entry.userId} className="mt-1 size-4 accent-accent" />
                        <label htmlFor={`pick-${entry.userId}`}>
                          <span className="font-semibold">{entry.login ? `@${entry.login}` : copy.ideas.by(null)}</span>
                          <span className="block break-words text-fg-muted">{entry.message}</span>
                        </label>
                      </div>
                    ))}
                  </fieldset>
                </ActionForm>
              ) : (
                <ul className="type-small flex flex-col gap-2">
                  {detail.interest.map((entry) => (
                    <li key={entry.userId}>
                      <span className="font-semibold">{entry.login ? `@${entry.login}` : copy.ideas.by(null)}</span>
                      <span className="block break-words text-fg-muted">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {(['taken', 'archived', 'open'] as const)
                  .filter((status) => (status === 'open' ? idea.status === 'taken' || idea.status === 'archived' : idea.status !== status))
                  .map((status) => (
                    <ActionForm key={status} action={setIdeaStatusAction} values={{ ...values, status }} submitLabel={copy.idea.setStatus[status]} successMessage={copy.idea.statusSaved} variant="ghost" />
                  ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
