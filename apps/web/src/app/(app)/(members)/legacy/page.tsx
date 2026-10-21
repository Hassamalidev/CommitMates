import { getLegacy, getUniversity, inviteFor } from '@commitmates/core';
import { Button, Card, Chip, CompanionView, EmptyState, Input, Select, UnlockCard, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { campusCopy } from '@/copy/campus';
import { legacyCopy } from '@/copy/legacy';
import { companionFor } from '@/lib/dev-card';
import { siteUrl } from '@/lib/site';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: legacyCopy.meta.title, robots: { index: false } };
}

type Params = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Params> };

const first = (value: string | string[] | undefined): string | undefined => {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  return raw === '' ? undefined : raw;
};

/** Senior's Legacy (CLAUDE.md §8 F17 "UI"): search the university's library of showcased projects. */
export default async function LegacyPage({ searchParams }: Props) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/legacy');
  if (member.universityId === null) redirect('/onboarding');
  const copy = legacyCopy;
  const params = await searchParams;
  const query = { q: first(params.q), tag: first(params.tag), from: first(params.from), to: first(params.to), department: first(params.department), sort: first(params.sort) };
  const header = (
    <header>
      <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
      <h1 className="type-h1 mt-1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">{copy.intro}</p>
      <Link href="/settings/projects" className="type-small mt-2 inline-flex min-h-11 items-center underline">
        {copy.showcaseLink}
      </Link>
    </header>
  );

  const view = await getLegacy(member, Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))).catch(() => getLegacy(member, {}));
  if (view.state !== 'open') {
    const [university, invite] = await Promise.all([getUniversity(member.universityId), inviteFor(member, member.universityId)]);
    const link = university && invite ? `${siteUrl}/?ref=${encodeURIComponent(university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
    const progress = view.state === 'locked' ? view : { current: 0, required: 0 };
    return (
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
        {header}
        <UnlockCard
          title={campusCopy.unlocks.legacy.title}
          description={copy.locked}
          current={progress.current}
          required={progress.required}
          progressLabel={campusCopy.progress.legacyProjects(progress.current, progress.required)}
          action={link ? <InviteButton link={link} /> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-10">
      {header}
      <Card>
        <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input label={copy.search.label} name="q" type="search" defaultValue={query.q ?? ''} maxLength={100} />
          <Input label={copy.search.tag} name="tag" defaultValue={query.tag ?? ''} maxLength={100} />
          <Select
            label={copy.search.department}
            name="department"
            defaultValue={query.department ?? ''}
            options={[{ value: '', label: copy.search.anyDepartment }, ...view.departments.map((department) => ({ value: department.id, label: department.name }))]}
          />
          <Input label={copy.search.from} name="from" type="number" inputMode="numeric" defaultValue={query.from ?? ''} />
          <Input label={copy.search.to} name="to" type="number" inputMode="numeric" defaultValue={query.to ?? ''} />
          <Select
            label={copy.search.sort}
            name="sort"
            defaultValue={query.sort === 'stars' ? 'stars' : 'relevance'}
            options={(['relevance', 'stars'] as const).map((value) => ({ value, label: copy.search.sorts[value] }))}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" variant="primary" size="md">
              {copy.search.submit}
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="legacy-results" className="flex flex-col gap-3">
        <h2 id="legacy-results" className="type-h2">
          {copy.results.count(view.entries.length)}
        </h2>
        {view.expanded.length > 0 ? <p className="type-small text-fg-muted">{copy.search.expanded(view.expanded.join(', '))}</p> : null}
        {view.entries.length === 0 ? (
          <Card>
            <EmptyState title={copy.results.count(0)} description={copy.results.empty} />
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {view.entries.map((entry) => (
              <li key={entry.id}>
                <Card as="article" aria-label={entry.fullName} className="flex h-full flex-col gap-2">
                  <div className="flex items-start gap-3">
                    <CompanionView companion={companionFor({ companion: entry.companion })} state="idle" size={64} label={copy.results.companion(entry.ownerLogin)} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <h3 className="type-h3 break-words">
                        <Link href={`/legacy/${entry.id}`} className="text-accent underline underline-offset-4" aria-label={copy.results.open(entry.fullName)}>
                          {entry.fullName}
                        </Link>
                      </h3>
                      <p className="type-small text-fg-muted">
                        {[
                          copy.results.by(entry.ownerLogin),
                          entry.standing ? copy.results.standing[entry.standing] : null,
                          entry.gradYear !== null ? copy.results.year(entry.gradYear) : null,
                          entry.department,
                          copy.results.stars(entry.stars),
                        ]
                          .filter((part): part is string => part !== null)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  {entry.blurb ?? entry.description ? <p className="type-body break-words">{entry.blurb ?? entry.description}</p> : null}
                  {entry.tags.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" aria-label={copy.search.tag}>
                      {entry.tags.slice(0, 8).map((tag) => (
                        <li key={tag}>
                          <Link href={`/legacy?tag=${encodeURIComponent(tag)}`} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
                            <Chip>{tag}</Chip>
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
      </section>
    </div>
  );
}
