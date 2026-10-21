import { getLeaderboards, getUniversity, inviteFor, type Board, type BoardEntry } from '@commitmates/core';
import { Accordion, Card, Chip, CompanionView, EmptyState, Tabs, UnlockCard } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { ActionForm } from '@/components/forms/ActionForm';
import { campusCopy } from '@/copy/campus';
import { leaderboardsCopy } from '@/copy/leaderboards';
import { companionFor } from '@/lib/dev-card';
import { siteUrl } from '@/lib/site';
import { setLeaderboardOptInAction } from '@/server/actions/leaderboards';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: leaderboardsCopy.meta.title, robots: { index: false } };
}

const copy = leaderboardsCopy;

/** The metrics behind an entry, in words. */
function breakdown(entry: BoardEntry, kind: 'group' | 'member'): string {
  const m = entry.metrics;
  if (kind === 'member') return [copy.metrics.activeDays(m.activeDays ?? 0), copy.metrics.helpfulReviews(m.helpfulReviews ?? 0)].join(' · ');
  return [
    copy.metrics.activeRatio(m.activeRatio ?? 0),
    copy.metrics.medianActiveDays(m.medianActiveDays ?? 0),
    copy.metrics.revivals(m.revivals ?? 0),
    copy.metrics.helpfulReviews(m.helpfulReviews ?? 0),
  ].join(' · ');
}

function BoardList({ board, kind, empty, label }: { board: Board; kind: 'group' | 'member'; empty: string; label: string }) {
  if (board.entries.length === 0) {
    return (
      <Card>
        <EmptyState title={label} description={empty} />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {board.weekStart ? <p className="type-small text-fg-muted">{copy.week(board.weekStart)}</p> : null}
      <ol className="flex flex-col gap-2" aria-label={label}>
        {board.entries.map((entry) => (
          <li key={entry.scopeId}>
            <Card as="article" aria-label={entry.name} className={entry.isViewer ? 'border-accent' : undefined}>
              <div className="flex items-center gap-3">
                <span className="type-h2 w-12 shrink-0 text-center font-mono">{copy.rank(entry.rank)}</span>
                <CompanionView companion={companionFor({ companion: entry.companion })} state="idle" size={64} label={copy.companion(entry.name)} />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    {entry.slug ? (
                      <Link href={`/uni/${entry.slug}`} className="type-body font-semibold break-words underline">
                        {entry.name}
                      </Link>
                    ) : (
                      <span className="type-body font-semibold break-words">{kind === 'member' ? `@${entry.name}` : entry.name}</span>
                    )}
                    {entry.isViewer ? <Chip>{kind === 'member' ? copy.you : copy.yours}</Chip> : null}
                    <span className="type-small text-fg-muted">{copy.change(entry.previousRank, entry.rank)}</span>
                  </span>
                  <span className="type-small text-fg-muted">{breakdown(entry, kind)}</span>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Leaderboards (CLAUDE.md §8 F19 "UI"): universities in the country, departments, opted-in members. */
export default async function LeaderboardsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/leaderboards');
  if (member.universityId === null) redirect('/onboarding');
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
    </header>
  );
  const view = await getLeaderboards(member);
  if (view.state !== 'open') {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    const progress = view.state === 'locked' ? view : { current: 0, required: 0 };
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.leaderboard.title}
          description={copy.locked}
          current={progress.current}
          required={progress.required}
          progressLabel={campusCopy.progress.members(progress.current, progress.required)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs
          label={copy.tabs.label}
          items={[
            {
              value: 'universities',
              label: copy.tabs.universities,
              content: <BoardList board={view.universities} kind="group" empty={copy.empty.universities} label={copy.tabs.universities} />,
            },
            {
              value: 'departments',
              label: copy.tabs.departments,
              content: <BoardList board={view.departments} kind="group" empty={copy.empty.departments(view.rules.minDeptMembers)} label={copy.tabs.departments} />,
            },
            {
              value: 'members',
              label: copy.tabs.members,
              content: <BoardList board={view.members} kind="member" empty={copy.empty.members} label={copy.tabs.members} />,
            },
          ]}
        />
        <aside className="flex flex-col gap-4" aria-label={copy.optIn.title}>
          <Card title={copy.optIn.title} titleAs="h2" className="flex flex-col gap-2">
            <p className="type-small">{view.optedIn ? copy.optIn.inLine : copy.optIn.outLine}</p>
            <ActionForm
              action={setLeaderboardOptInAction}
              values={{ optIn: view.optedIn ? 'false' : 'true' }}
              submitLabel={view.optedIn ? copy.optIn.leave : copy.optIn.join}
              successMessage={view.optedIn ? copy.optIn.left : copy.optIn.joined}
              variant={view.optedIn ? 'ghost' : 'primary'}
            />
          </Card>
          <Accordion
            items={[
              {
                value: 'how',
                title: copy.how.title,
                content: (
                  <ul className="type-small flex list-disc flex-col gap-2 pl-5">
                    {copy.how.lines(view.rules.minActiveDays, view.rules.weights).map((line) => (
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
