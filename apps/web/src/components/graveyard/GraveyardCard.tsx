import type { GraveyardItem } from '@commitmates/core';
import { Card, Chip, buttonStyles } from '@commitmates/ui';

import { graveyardCopy } from '@/copy/graveyard';
import { formatCalendarDate } from '@/lib/dev-card';
import { askOwnerUrl, forkUrl } from '@/lib/graveyard';

/** One inactive project: what it is, why it is here, and a legal, polite way to pick it up (CLAUDE.md §8 F7). */
export function GraveyardCard({ item }: { item: GraveyardItem }) {
  const copy = graveyardCopy.result;
  const difficulty = item.difficulty === null ? undefined : graveyardCopy.difficulty[item.difficulty];
  const why = [
    item.signals.readmeUnfinished ? copy.why.readme : null,
    item.signals.unansweredIssues !== null && item.signals.unansweredIssues > 0 ? copy.why.issues(item.signals.unansweredIssues) : null,
    item.signals.unfinishedCommits !== null && item.signals.unfinishedCommits > 0 ? copy.why.commits(item.signals.unfinishedCommits) : null,
    item.signals.noReleases ? copy.why.noReleases : null,
  ].filter((line): line is string => line !== null);
  const licensed = item.licenseSpdx !== null;
  const titleId = `grave-${item.fullName.replace(/[^a-z0-9]/gi, '-')}`;

  return (
    <Card as="article" aria-labelledby={titleId} data-testid="graveyard-item" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="type-h3 break-all">
          <a href={`https://github.com/${item.fullName}`} rel="noreferrer" className="text-accent underline underline-offset-4">
            {item.fullName}
          </a>
        </h3>
        <div className="flex flex-wrap gap-2">
          {difficulty ? <Chip>{difficulty}</Chip> : null}
          <Chip>{licensed ? copy.license(item.licenseSpdx ?? '') : copy.noLicense}</Chip>
          {item.archived ? <Chip>{copy.archived}</Chip> : null}
        </div>
      </header>
      {item.description ? <p className="type-body text-fg-muted">{item.description}</p> : null}
      <p className="type-small text-fg-muted">
        {[
          copy.stars(item.stars),
          copy.forks(item.forks),
          copy.issues(item.openIssues),
          `${copy.idle(item.idleMonths)}${item.pushedAt ? `, ${copy.lastPush(formatCalendarDate(item.pushedAt.slice(0, 10)))}` : ''}`,
        ].join(' · ')}
      </p>
      <div>
        <div className="type-small flex justify-between text-fg-muted">
          <span>{copy.revivability}</span>
          <span className="font-mono">{copy.revivabilityValue(Math.min(1, item.revivability))}</span>
        </div>
        <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, item.revivability) * 100}%` }} />
        </div>
      </div>
      {why.length > 0 ? (
        <details>
          <summary className="type-small inline-flex min-h-11 cursor-pointer items-center font-semibold text-accent sm:min-h-0">{copy.whyTitle}</summary>
          <ul className="type-small mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {licensed && !item.archived ? (
          <a href={forkUrl(item.fullName)} rel="noreferrer" className={buttonStyles({ variant: 'primary', size: 'sm' })}>
            {graveyardCopy.actions.fork}
          </a>
        ) : null}
        <a href={askOwnerUrl(item.fullName)} rel="noreferrer" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
          {licensed ? graveyardCopy.actions.ask : graveyardCopy.actions.askFirst}
        </a>
      </div>
      {licensed ? null : <p className="type-small text-fg-muted">{graveyardCopy.actions.noLicenseNote}</p>}
    </Card>
  );
}
