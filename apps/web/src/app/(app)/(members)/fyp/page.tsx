import {
  FYP_DESCRIPTION_MAX,
  FYP_DESCRIPTION_MIN,
  FYP_TITLE_MAX,
  fypBoardAccess,
  getUniversity,
  inviteFor,
  listIdeas,
  listPastProjects,
  listSupervisors,
  supervisorStanding,
} from '@commitmates/core';
import { Card, Chip, EmptyState, Input, Select, StateChip, Tabs, UnlockCard, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { IdeaComposer } from '@/components/fyp/IdeaComposer';
import { ActionForm } from '@/components/forms/ActionForm';
import { campusCopy } from '@/copy/campus';
import { fypBoardCopy } from '@/copy/fyp-board';
import { siteUrl } from '@/lib/site';
import { applySupervisorAction, checkIdeaAction, postIdeaAction } from '@/server/actions/fyp-board';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: fypBoardCopy.meta.title, robots: { index: false } };
}

const copy = fypBoardCopy;
const STATUS_STATE = { open: 'idle', team_forming: 'working', taken: 'done', archived: 'idle' } as const;
const STATUSES = ['open', 'team_forming', 'taken', 'archived'] as const;

type Props = { searchParams: Promise<{ tag?: string; status?: string; supervisor?: string }> };

/** The FYP Board (CLAUDE.md §8 F22 "UI"): ideas, supervisors and past projects of the member's university. */
export default async function FypBoardPage({ searchParams }: Props) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/fyp');
  if (member.universityId === null) redirect('/onboarding');
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
    </header>
  );
  const access = await fypBoardAccess(member);
  if (access.state !== 'open') {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        {access.state === 'locked' ? (
          <UnlockCard
            title={campusCopy.unlocks.fypBoard.title}
            description={copy.locked}
            current={access.current}
            required={access.required}
            progressLabel={campusCopy.progress.members(access.current, access.required)}
            action={link ? <InviteButton link={link} /> : undefined}
          />
        ) : (
          <p className="type-body">{copy.unverified}</p>
        )}
      </div>
    );
  }

  const params = await searchParams;
  const filter = { tag: params.tag ?? '', status: STATUSES.find((status) => status === params.status) ?? '', supervisorOnly: params.supervisor === 'on' };
  const [ideas, supervisors, past, standing] = await Promise.all([listIdeas(member, filter), listSupervisors(member), listPastProjects(member), supervisorStanding(member)]);
  const statusOptions = [{ value: '', label: copy.ideas.anyStatus }, ...STATUSES.map((value) => ({ value, label: copy.status[value] }))];

  const ideasTab = (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-col gap-3 rounded-card border border-line p-4" aria-label={copy.ideas.filtersTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={copy.ideas.tag} name="tag" defaultValue={filter.tag} />
          <Select label={copy.ideas.status} name="status" defaultValue={filter.status} options={statusOptions} />
        </div>
        <label className="type-small flex min-h-11 items-center gap-2">
          <input type="checkbox" name="supervisor" defaultChecked={filter.supervisorOnly} className="size-4 accent-accent" />
          {copy.ideas.supervisorOnly}
        </label>
        <button type="submit" className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'self-start' })}>
          {copy.ideas.apply}
        </button>
      </form>
      {ideas.length === 0 ? (
        <Card>
          <EmptyState title={copy.ideas.title} description={copy.ideas.empty} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {ideas.map((idea) => (
            <li key={idea.id}>
              <Card as="article" aria-label={idea.title} className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/fyp/ideas/${idea.id}`} className="type-body font-semibold break-words underline">
                    {idea.title}
                  </Link>
                  <StateChip state={STATUS_STATE[idea.status]} label={copy.status[idea.status]} />
                </span>
                <p className="type-small text-fg-muted">
                  {[copy.ideas.by(idea.authorLogin), copy.ideas.interested(idea.interested)].join(' · ')}
                  {idea.supervisorIdea ? ` · ${copy.ideas.supervisorIdea}` : ''}
                </p>
                <p className="type-small line-clamp-3 break-words">{idea.description}</p>
                {idea.keyphrases.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" aria-label={copy.post.keyphrases}>
                    {idea.keyphrases.map((phrase) => (
                      <li key={phrase}>
                        <Link href={`/fyp?tag=${encodeURIComponent(phrase)}`} className="type-small rounded-full border border-line px-2 py-1 underline">
                          {phrase}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <IdeaComposer
        limits={{ titleMax: FYP_TITLE_MAX, descriptionMin: FYP_DESCRIPTION_MIN, descriptionMax: FYP_DESCRIPTION_MAX }}
        canPostAsSupervisor={(standing.application?.approvedAt ?? null) !== null}
        check={checkIdeaAction}
        post={postIdeaAction}
      />
    </div>
  );

  const supervisorsTab = (
    <div className="flex flex-col gap-6">
      {supervisors.length === 0 ? (
        <Card>
          <EmptyState title={copy.supervisors.title} description={copy.supervisors.empty} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {supervisors.map((supervisor) => (
            <li key={supervisor.userId}>
              <Card as="article" aria-label={supervisor.login ? `@${supervisor.login}` : copy.supervisors.title} className="flex flex-col gap-2">
                <span className="type-body font-semibold">{supervisor.login ? `@${supervisor.login}` : copy.supervisors.title}</span>
                <ul className="flex flex-wrap gap-2" aria-label={copy.supervisors.areas}>
                  {supervisor.areas.map((area) => (
                    <li key={area}>
                      <Chip>{area}</Chip>
                    </li>
                  ))}
                </ul>
                <p className="type-small text-fg-muted">{copy.supervisors.openIdeas(supervisor.openIdeas)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {standing.canApply ? (
        <Card title={copy.supervisors.applyTitle} titleAs="h2" className="flex flex-col gap-3">
          <p className="type-small text-fg-muted">{copy.supervisors.applyIntro}</p>
          {standing.application ? <p className="type-small">{standing.application.approvedAt ? copy.supervisors.approved : copy.supervisors.waiting}</p> : null}
          <ActionForm
            action={applySupervisorAction}
            submitLabel={standing.application ? copy.supervisors.update : copy.supervisors.apply}
            successMessage={copy.supervisors.applied}
            className="flex flex-col items-start gap-2"
          >
            <Input
              label={copy.supervisors.areas}
              name="areas"
              defaultValue={standing.application?.areas.join(', ') ?? ''}
              description={copy.supervisors.areasHelp(standing.maxAreas)}
              className="w-full"
            />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );

  const pastTab = (
    <div className="flex flex-col gap-3">
      <p className="type-small text-fg-muted">
        {copy.past.intro}{' '}
        <Link href="/settings/projects" className="text-accent underline underline-offset-4">
          {copy.past.manage}
        </Link>
      </p>
      {past.length === 0 ? (
        <Card>
          <EmptyState title={copy.past.title} description={copy.past.empty} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {past.map((project) => (
            <li key={project.id}>
              <Card as="article" aria-label={project.fullName ?? copy.past.title} className="flex flex-col gap-1">
                {project.fullName ? (
                  <a href={`https://github.com/${project.fullName}`} rel="noreferrer" className="type-body font-semibold break-all text-accent underline underline-offset-4">
                    {project.fullName}
                  </a>
                ) : null}
                {project.description ? <p className="type-small text-fg-muted">{project.description}</p> : null}
                <p className="type-small">
                  {[project.year !== null ? copy.match.year(project.year) : null, project.ownerLogin ? `@${project.ownerLogin}` : null].filter((part) => part !== null).join(' · ')}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      <Tabs
        label={copy.tabs.label}
        items={[
          { value: 'ideas', label: copy.tabs.ideas, content: ideasTab },
          { value: 'supervisors', label: copy.tabs.supervisors, content: supervisorsTab },
          { value: 'past', label: copy.tabs.past, content: pastTab },
        ]}
      />
    </div>
  );
}
