import type { UniversitySummary, VouchingStatus } from '@commitmates/core';
import { Button, Card, Input } from '@commitmates/ui';

import { ActionForm } from '@/components/forms/ActionForm';
import { onboardingCopy } from '@/copy/onboarding';
import { chooseUniversityAction } from '@/server/actions/verification';

export type VouchPathProps = {
  status: VouchingStatus | null;
  required: number;
  query: string;
  results: readonly UniversitySummary[];
  /** The member's own profile link to share with vouchers; `null` without a GitHub login. */
  profileUrl: string | null;
};

/**
 * The path for members without a working university email (CLAUDE.md §8 F10 step 5): pick the
 * university, then collect vouches from members verified there. The search is a plain GET form,
 * so it works without JavaScript.
 */
export function VouchPath({ status, required, query, results, profileUrl }: VouchPathProps) {
  const copy = onboardingCopy.vouch;
  return (
    <Card title={copy.title} className="flex flex-col gap-4">
      <p className="type-small text-fg-muted">{copy.line(required)}</p>
      {status ? (
        <div role="status" className="flex flex-col gap-1 rounded-control border border-line bg-surface-2 p-3">
          <p className="type-body">{copy.waiting(status.universityName, status.vouches, status.required)}</p>
          {profileUrl ? (
            <p className="type-small">
              {copy.share} <a href={profileUrl} className="break-all text-accent underline underline-offset-4">{profileUrl}</a>
            </p>
          ) : (
            <p className="type-small text-fg-muted">{copy.noLink}</p>
          )}
        </div>
      ) : null}
      <form method="get" action="/onboarding" className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input className="flex-1" name="q" type="search" label={copy.searchLabel} defaultValue={query} minLength={2} maxLength={100} />
        <Button type="submit" variant="secondary" size="md" className="sm:mt-[26px]">
          {copy.search}
        </Button>
      </form>
      {query.trim().length >= 2 && results.length === 0 ? <p className="type-small text-fg-muted">{copy.none}</p> : null}
      {results.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {results.map((university) => (
            <li key={university.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3">
              <span className="type-body">
                {university.name} <span className="type-small text-fg-muted">· {university.country}</span>
              </span>
              <ActionForm
                action={chooseUniversityAction}
                values={{ universityId: university.id }}
                submitLabel={copy.choose}
                successMessage={copy.chosen}
                className="flex flex-col items-end"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
