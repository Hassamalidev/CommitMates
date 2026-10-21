import { getLegacyDetail } from '@commitmates/core';
import { Card, Chip, CompanionView, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AskDialog } from '@/components/chat/AskDialog';
import { legacyCopy } from '@/copy/legacy';
import { companionFor } from '@/lib/dev-card';
import { askLegacyAuthorAction } from '@/server/actions/legacy';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: legacyCopy.meta.title, robots: { index: false } };
}

type Props = { params: Promise<{ id: string }> };

/** One library entry (CLAUDE.md §8 F17 "UI"): the project, the start of its README, and Ask the author. */
export default async function LegacyEntryPage({ params }: Props) {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/legacy');
  const detail = await getLegacyDetail(member, { entryId: (await params).id }).catch(() => null);
  if (!detail) notFound();
  const copy = legacyCopy;
  const meta = [
    copy.results.by(detail.ownerLogin),
    detail.standing ? copy.results.standing[detail.standing] : null,
    detail.gradYear !== null ? copy.results.year(detail.gradYear) : null,
    detail.department,
    copy.results.stars(detail.stars),
  ].filter((part): part is string => part !== null);

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <Link href="/legacy" className="type-small inline-flex min-h-11 items-center underline">
        {copy.detail.back}
      </Link>
      <header className="flex items-start gap-4">
        <CompanionView companion={companionFor({ companion: detail.companion })} state="idle" size={96} label={copy.results.companion(detail.ownerLogin)} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
          <h1 className="type-h1 break-words">{detail.fullName}</h1>
          <p className="type-small text-fg-muted">{meta.join(' · ')}</p>
        </div>
      </header>

      {detail.blurb ? <p className="type-body break-words">{detail.blurb}</p> : null}
      {detail.description && detail.description !== detail.blurb ? <p className="type-body text-fg-muted break-words">{detail.description}</p> : null}
      <div className="flex flex-wrap gap-2">
        {detail.primaryLanguage ? <Chip>{copy.detail.language(detail.primaryLanguage)}</Chip> : null}
        {detail.tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>

      <Card title={copy.detail.readme} titleAs="h2">
        {detail.excerpt ? <p className="type-body whitespace-pre-line break-words">{detail.excerpt}</p> : <p className="type-small text-fg-muted">{copy.detail.noReadme}</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <a href={`https://github.com/${detail.fullName}`} rel="noopener noreferrer" target="_blank" className={buttonStyles({ variant: 'secondary', size: 'md' })}>
          {copy.detail.github}
        </a>
        {detail.canAsk ? (
          <AskDialog
            login={detail.ownerLogin}
            title={copy.detail.askTitle(detail.ownerLogin)}
            values={{ entryId: detail.id }}
            prefill={copy.detail.prefill(detail.fullName)}
            action={askLegacyAuthorAction}
          />
        ) : (
          <p className="type-small text-fg-muted">{detail.ownerUserId === member.id ? copy.detail.yours : copy.detail.noQuestions}</p>
        )}
      </div>
    </div>
  );
}
