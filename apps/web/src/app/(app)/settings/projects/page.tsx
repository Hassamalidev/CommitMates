import { getProjects } from '@commitmates/core';
import { Card, Input, Select, StateChip } from '@commitmates/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { projectsCopy } from '@/copy/projects';
import { formatUtc } from '@/lib/format';
import { dismissSuggestionAction, listRepoAction, withdrawListingAction } from '@/server/actions/projects';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: projectsCopy.meta.title, robots: { index: false } };
}

const STATUS_STATE = { listed: 'waiting', adopted: 'done', withdrawn: 'idle' } as const;

/**
 * The owner's adoption listings and private suggestions (CLAUDE.md §8 F14): suggestions are shown
 * here only, to the owner; listings are visible to members of their university.
 */
export default async function ProjectsPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/settings/projects');
  const copy = projectsCopy;
  const header = (
    <div>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 text-fg-muted">{copy.intro}</p>
    </div>
  );
  if (!member.verified) {
    return (
      <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
        {header}
        <p className="type-body">{copy.verifyFirst}</p>
      </div>
    );
  }
  const { listings, suggestions, others, noteMaxChars } = await getProjects(member);
  const noteField = <Input label={copy.note} name="note" maxLength={noteMaxChars} description={copy.noteHelp(noteMaxChars)} />;

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      {header}

      <Card title={copy.listingsTitle} titleAs="h2" className="flex flex-col gap-3">
        {listings.length === 0 ? (
          <p className="type-small text-fg-muted">{copy.listingsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listings.map((listing) => (
              <li key={listing.listingId} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="flex flex-wrap items-center gap-2">
                  <a href={`https://github.com/${listing.fullName}`} className="type-body font-semibold break-words underline" rel="noopener noreferrer" target="_blank">
                    {listing.fullName}
                  </a>
                  <StateChip state={STATUS_STATE[listing.status]} label={copy.status[listing.status]} />
                </span>
                {listing.note ? <p className="type-small break-words">{listing.note}</p> : null}
                {listing.status === 'listed' ? (
                  <ActionForm action={withdrawListingAction} values={{ listingId: listing.listingId }} submitLabel={copy.withdrawLabel(listing.fullName)} variant="ghost" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {suggestions.length > 0 ? (
        <Card title={copy.suggestionsTitle} titleAs="h2" className="flex flex-col gap-3">
          <p className="type-small text-fg-muted">{copy.suggestionsIntro}</p>
          <ul className="flex flex-col gap-4">
            {suggestions.map((suggestion) => (
              <li key={suggestion.githubId} className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
                <p className="type-body font-semibold break-words">{suggestion.fullName}</p>
                {suggestion.pushedAt ? <p className="type-small text-fg-muted">{copy.lastPush(formatUtc(suggestion.pushedAt) ?? '')}</p> : null}
                <ActionForm
                  action={listRepoAction}
                  values={{ repoGithubId: String(suggestion.githubId) }}
                  submitLabel={copy.listLabel(suggestion.fullName)}
                  successMessage={copy.listed}
                  variant="primary"
                  className="flex flex-col items-start gap-2"
                >
                  {noteField}
                </ActionForm>
                <ActionForm action={dismissSuggestionAction} values={{ repoGithubId: String(suggestion.githubId) }} submitLabel={copy.dismissLabel(suggestion.fullName)} variant="ghost" />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={copy.otherTitle} titleAs="h2" className="flex flex-col gap-3">
        {others.length === 0 ? (
          <p className="type-small text-fg-muted">{copy.otherEmpty}</p>
        ) : (
          <ActionForm action={listRepoAction} submitLabel={copy.list} successMessage={copy.listed} variant="secondary" className="flex flex-col items-start gap-3">
            <Select
              label={copy.otherLabel}
              name="repoGithubId"
              required
              options={others.map((repo) => ({ value: String(repo.githubId), label: repo.fullName }))}
              className="w-full"
            />
            {noteField}
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
