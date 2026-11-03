import { getAlumni, getUniversity, inviteFor } from '@commitmates/core';
import { Accordion, Card, Chip, EmptyState, Input, StateChip, Textarea, UnlockCard } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { ActionForm } from '@/components/forms/ActionForm';
import { alumniCopy } from '@/copy/alumni';
import { campusCopy } from '@/copy/campus';
import { siteUrl } from '@/lib/site';
import { answerQuestionAction, askQuestionAction, correctGraduationAction, passQuestionAction } from '@/server/actions/alumni';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: alumniCopy.meta.title, robots: { index: false } };
}

const copy = alumniCopy;

const QUESTION_STATE = { open: 'waiting', answered: 'done', closed: 'idle', expired: 'idle' } as const;
const ROUTE_STATE = { pending: 'waiting', answered: 'done', passed: 'idle', expired: 'idle' } as const;

type Props = { searchParams: Promise<{ tags?: string | string[] }> };

/** Alumni Quick Asks (CLAUDE.md §8 F20): ask, the member's questions, and for alumni the questions routed to them. */
export default async function AlumniPage({ searchParams }: Props) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/alumni');
  if (member.universityId === null) redirect('/onboarding');
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
    </header>
  );

  const view = await getAlumni(member);
  if (view.state === 'locked') {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.alumni.title}
          description={copy.locked}
          current={view.current}
          required={view.required}
          progressLabel={campusCopy.progress.alumni(view.current, view.required)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
      </div>
    );
  }

  const { tags } = await searchParams;
  const prefill = Array.isArray(tags) ? tags.join(', ') : (tags ?? '');

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {view.inbox ? (
            <section aria-labelledby="inbox-title" className="flex flex-col gap-3">
              <h2 id="inbox-title" className="type-h2">
                {copy.inbox.title}
              </h2>
              <p className="type-small text-fg-muted">{copy.inbox.intro}</p>
              {view.inbox.length === 0 ? (
                <Card>
                  <EmptyState title={copy.inbox.title} description={copy.inbox.empty} />
                </Card>
              ) : (
                <ul className="flex flex-col gap-3">
                  {view.inbox.map((question) => {
                    const from = copy.inbox.from(question.askerLogin);
                    const waiting = question.routeStatus === 'pending' && question.status === 'open';
                    return (
                      <li key={question.questionId}>
                        <Card as="article" aria-label={from} className="flex flex-col gap-2">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="type-small font-semibold">{from}</span>
                            <StateChip state={ROUTE_STATE[question.routeStatus as keyof typeof ROUTE_STATE]} label={copy.inbox.status[question.routeStatus as keyof typeof ROUTE_STATE]} />
                          </span>
                          <p className="type-body break-words whitespace-pre-line">{question.body}</p>
                          {question.tags.length > 0 ? (
                            <ul className="flex flex-wrap gap-2" aria-label={copy.ask.tags}>
                              {question.tags.map((tag) => (
                                <li key={tag}>
                                  <Chip>{tag}</Chip>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {waiting ? (
                            <div className="flex flex-wrap gap-2">
                              <ActionForm action={answerQuestionAction} values={{ questionId: question.questionId }} submitLabel={copy.inbox.answer} variant="primary" />
                              <ActionForm action={passQuestionAction} values={{ questionId: question.questionId }} submitLabel={copy.inbox.pass} successMessage={copy.inbox.passed} variant="ghost" />
                            </div>
                          ) : null}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          <Card title={copy.ask.title} titleAs="h2" className="flex flex-col gap-3">
            <ActionForm action={askQuestionAction} submitLabel={copy.ask.submit} successMessage={copy.ask.sent} variant="primary" size="md" className="flex flex-col items-start gap-3">
              <Textarea label={copy.ask.body} name="body" rows={4} required maxLength={view.rules.maxChars} description={copy.ask.bodyHelp(view.rules.maxChars)} className="w-full" />
              <Input label={copy.ask.tags} name="tags" defaultValue={prefill} description={copy.ask.tagsHelp(view.rules.maxTags)} className="w-full" />
              {view.suggestions.length > 0 ? (
                <p className="type-small text-fg-muted">
                  {copy.ask.suggestions}: {view.suggestions.join(', ')}
                </p>
              ) : null}
              <label className="type-small flex min-h-11 items-start gap-2">
                <input type="checkbox" name="anonymous" className="mt-1 size-4 accent-accent" />
                <span>
                  {copy.ask.anonymous}
                  <span className="block text-fg-muted">{copy.ask.anonymousHelp}</span>
                </span>
              </label>
            </ActionForm>
          </Card>

          <section aria-labelledby="mine-title" className="flex flex-col gap-3">
            <h2 id="mine-title" className="type-h2">
              {copy.mine.title}
            </h2>
            {view.asked.length === 0 ? (
              <Card>
                <EmptyState title={copy.mine.title} description={copy.mine.empty} />
              </Card>
            ) : (
              <ul className="flex flex-col gap-3">
                {view.asked.map((question) => (
                  <li key={question.id}>
                    <Card as="article" aria-label={question.body.slice(0, 80)} className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <StateChip state={QUESTION_STATE[question.status]} label={copy.mine.status[question.status]} />
                        {question.anonymous ? <span className="type-small text-fg-muted">{copy.mine.anonymous}</span> : null}
                      </span>
                      <p className="type-body break-words whitespace-pre-line">{question.body}</p>
                      {question.tags.length > 0 ? (
                        <ul className="flex flex-wrap gap-2" aria-label={copy.ask.tags}>
                          {question.tags.map((tag) => (
                            <li key={tag}>
                              <Chip>{tag}</Chip>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {question.status === 'open' ? <p className="type-small text-fg-muted">{copy.mine.round(question.round)}</p> : null}
                      {question.status === 'expired' ? <p className="type-small text-fg-muted">{copy.mine.expired}</p> : null}
                      {question.status === 'answered' ? (
                        <p className="type-small">
                          {copy.mine.answeredBy(question.answeredByLogin)}{' '}
                          {question.threadId ? (
                            <Link href={`/inbox/${question.threadId}`} className="text-accent underline underline-offset-4">
                              {copy.mine.conversation}
                            </Link>
                          ) : null}
                        </p>
                      ) : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4" aria-label={copy.how.title}>
          {view.graduation ? (
            <Card title={copy.graduation.title} titleAs="h2" className="flex flex-col gap-2">
              <p className="type-small">{copy.graduation.line(view.graduation.gradYear)}</p>
              <ActionForm action={correctGraduationAction} submitLabel={copy.graduation.save} successMessage={copy.graduation.saved} className="flex flex-col items-start gap-2">
                <Input
                  label={copy.graduation.label}
                  name="gradYear"
                  type="number"
                  inputMode="numeric"
                  min={view.graduation.years.min}
                  max={view.graduation.years.max}
                  defaultValue={view.graduation.gradYear ?? ''}
                  description={copy.graduation.help(view.graduation.years.min, view.graduation.years.max)}
                />
              </ActionForm>
            </Card>
          ) : null}
          <Accordion
            items={[
              {
                value: 'how',
                title: copy.how.title,
                content: (
                  <ul className="type-small flex list-disc flex-col gap-2 pl-5">
                    {copy.how.lines(view.rules.slaHours, view.rules.maxRounds).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
