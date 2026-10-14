import type { DevCard } from '@commitmates/core';
import { Card, Chip, CompanionView, Heatmap, LanguageBar, RhythmStrip } from '@commitmates/ui';

import { devCardCopy, isDevCardLabelKey } from '@/copy/dev-card';
import { companionFor, formatCalendarDate, formatHour } from '@/lib/dev-card';

/**
 * The Dev Card itself (CLAUDE.md §8 F1 "Card layout"): companion and name, labels with
 * their evidence, languages, the hour rhythm, a 90-day heatmap, numbers and top skills.
 */
export function DevCardView({ card }: { card: DevCard }) {
  const copy = devCardCopy.card;
  const displayName = card.name ?? `@${card.login}`;
  const timezoneNote =
    card.timezoneSource === 'utc' ? copy.timezone.utc : copy.timezone[card.timezoneSource](card.timezone);

  return (
    <Card as="article" pixelShadow aria-labelledby="dev-card-title" data-testid="dev-card" className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-4">
        <CompanionView companion={companionFor(card)} state="idle" size={96} label={copy.companionLabel(card.login)} />
        <div className="min-w-0">
          <h2 id="dev-card-title" className="type-h2 break-words">
            {copy.title(displayName)}
          </h2>
          <a
            href={`https://github.com/${encodeURIComponent(card.login)}`}
            rel="noreferrer"
            className="type-small text-accent underline underline-offset-4"
          >
            {copy.githubLink(card.login)}
          </a>
        </div>
      </header>

      <section aria-labelledby="dev-card-labels">
        <h3 id="dev-card-labels" className="type-h3">
          {copy.labelsTitle}
        </h3>
        {card.labels.length === 0 ? (
          <p className="type-small mt-2 text-fg-muted">{copy.fewEvents}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {card.labels.map((label) => {
              const text = isDevCardLabelKey(label.key) ? devCardCopy.labels[label.key] : undefined;
              return text ? (
                <li key={label.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Chip className="font-semibold">{text.name}</Chip>
                  <span className="type-small text-fg-muted">{text.evidence(card.metrics)}</span>
                </li>
              ) : null;
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="dev-card-languages">
        <h3 id="dev-card-languages" className="type-h3">
          {copy.languagesTitle}
        </h3>
        {card.languages.length === 0 ? (
          <p className="type-small mt-2 text-fg-muted">{copy.noLanguages}</p>
        ) : (
          <LanguageBar
            className="mt-3"
            languages={card.languages}
            label={copy.languagesLabel}
            nameHeading={copy.languageHeading}
            shareHeading={copy.shareHeading}
          />
        )}
        {card.reposTruncated ? <p className="type-small mt-2 text-fg-muted">{copy.reposTruncated(card.reposAnalyzed)}</p> : null}
      </section>

      <section aria-labelledby="dev-card-rhythm">
        <h3 id="dev-card-rhythm" className="type-h3">
          {copy.rhythmTitle}
        </h3>
        <RhythmStrip
          className="mt-3"
          hours={card.hourHist}
          label={copy.rhythmLabel}
          formatHour={formatHour}
          emptyLabel={copy.rhythmEmpty}
        />
        <p className="type-small mt-2 text-fg-muted">
          {copy.windowNote} {timezoneNote}
        </p>
      </section>

      <section aria-labelledby="dev-card-calendar">
        <h3 id="dev-card-calendar" className="type-h3">
          {copy.calendarTitle}
        </h3>
        <div className="mt-3 overflow-x-auto pb-1">
          <Heatmap
            days={card.calendar90}
            label={copy.calendarLabel}
            describeDay={(day) => copy.day(formatCalendarDate(day.date), day.count)}
            hint={copy.calendarHint}
            dateHeading={copy.dateHeading}
            countHeading={copy.countHeading}
          />
        </div>
        {card.metrics.privateIncluded ? <p className="type-small mt-1 text-fg-muted">{copy.privateIncluded}</p> : null}
      </section>

      <section aria-labelledby="dev-card-stats">
        <h3 id="dev-card-stats" className="type-h3">
          {copy.statsTitle}
        </h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          {[
            { term: copy.stats.longestStreak, value: copy.stats.days(card.metrics.longestStreak) },
            { term: copy.stats.activeDays, value: copy.stats.days(card.metrics.activeDays90) },
            { term: copy.stats.total, value: card.metrics.total365.toLocaleString('en') },
          ].map((stat) => (
            <div key={stat.term} className="rounded-control border border-line bg-surface-2 p-3">
              <dt className="type-small text-fg-muted">{stat.term}</dt>
              <dd className="type-h3 font-mono">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="dev-card-tags">
        <h3 id="dev-card-tags" className="type-h3">
          {copy.tagsTitle}
        </h3>
        {card.tags.length === 0 ? (
          <p className="type-small mt-2 text-fg-muted">{copy.noTags}</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-2">
              {card.tags.map((tag) => (
                <li key={tag.tag}>
                  <Chip>{tag.tag}</Chip>
                </li>
              ))}
            </ul>
            <p className="type-small mt-2 text-fg-muted">{copy.tagsNote}</p>
          </>
        )}
      </section>
    </Card>
  );
}
