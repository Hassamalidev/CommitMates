'use client';

import { lateShares, mergeContributors, metricValue, teamMetrics, type FairnessMetric } from '@commitmates/algorithms';
import type { FairnessResult } from '@commitmates/core';
import { BarList, Card, Select, Timeline } from '@commitmates/ui';
import { useMemo, useState } from 'react';

import { fairnessCopy } from '@/copy/fairness';
import type { FairnessThresholds } from '@/lib/fairness';

/** A person counts as "late" when most of their commits fall in the final window. */
const LATE_MAJORITY = 0.5;

/**
 * The Code contribution report (CLAUDE.md §8 F4 "UI", "Copy rules"): shares per person on
 * commits or lines, the team picture in plain words, the weekly timeline, and a panel to
 * merge identities, all recomputed here with the same pure functions as the server.
 */
export function FairnessView({ result, thresholds }: { result: FairnessResult; thresholds: FairnessThresholds }) {
  const copy = fairnessCopy.result;
  const [merges, setMerges] = useState<Record<string, string>>({});
  const [includeBots, setIncludeBots] = useState(false);
  const [chosenMetric, setChosenMetric] = useState<FairnessMetric>('commits');

  const people = useMemo(() => mergeContributors(result.contributors, merges), [result.contributors, merges]);
  const visible = people.filter((person) => includeBots || !person.isBot);
  const linesKnown = visible.length > 0 && visible.every((person) => metricValue(person, 'lines') !== null);
  const metric: FairnessMetric = chosenMetric === 'lines' && linesKnown ? 'lines' : 'commits';
  const team = teamMetrics(people, { metric, includeBots, leastShareThreshold: thresholds.leastShareThreshold });
  const late = lateShares(visible, thresholds.lateWindowPct);
  const lateCount = [...late.values()].filter((share) => share > LATE_MAJORITY).length;
  const byKey = new Map(people.map((person) => [person.key, person]));
  const nameOf = (key: string) => {
    const person = byKey.get(key);
    return person ? (person.login ?? `${person.name} (${copy.unlinked})`) : key;
  };
  const unlinked = result.contributors.filter((person) => person.login === null);
  const accounts = result.contributors.filter((person) => person.login !== null);

  return (
    <Card as="article" pixelShadow aria-labelledby="fairness-title" data-testid="fairness-result" className="flex flex-col gap-8">
      <header>
        <h2 id="fairness-title" className="type-h2 break-words">
          {copy.heading(result.repo.fullName)}
        </h2>
        {result.mode === 'commits' ? <p className="type-small mt-2 text-fg-muted">{copy.commitsOnly(result.commitsAnalyzed)}</p> : null}
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label={copy.metricLabel}
          className="w-48"
          value={metric}
          onChange={(event) => {
            setChosenMetric(event.target.value === 'lines' ? 'lines' : 'commits');
          }}
          options={[
            { value: 'commits', label: copy.metrics.commits },
            { value: 'lines', label: copy.metrics.lines, disabled: !linesKnown },
          ]}
        />
        <label className="type-body flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={includeBots}
            onChange={(event) => {
              setIncludeBots(event.target.checked);
            }}
            className="size-5 accent-accent"
          />
          {copy.includeBots}
        </label>
      </div>
      {!linesKnown ? <p className="type-small -mt-4 text-fg-muted">{copy.linesUnavailable}</p> : null}

      <section aria-labelledby="fairness-shares">
        <h3 id="fairness-shares" className="type-h3">
          {copy.sharesTitle}
        </h3>
        <BarList
          className="mt-3"
          label={copy.sharesLabel(copy.metrics[metric])}
          nameHeading={copy.personHeading}
          valueHeading={copy.shareHeading}
          items={team.people.map((entry) => ({
            key: entry.key,
            label: nameOf(entry.key),
            value: entry.value,
            valueLabel: copy.shareValue(entry.share, entry.value, metric),
          }))}
        />
      </section>

      <section aria-labelledby="fairness-team" data-testid="fairness-team">
        <h3 id="fairness-team" className="type-h3">
          {copy.teamTitle}
        </h3>
        <ul className="type-body mt-2 flex list-disc flex-col gap-1 pl-5">
          {!team.applicable ? (
            <li>{copy.single}</li>
          ) : (
            <>
              <li>{team.flagged ? copy.flagged(thresholds.leastShareThreshold) : copy.balanced}</li>
              {team.leastShareRatio === null ? null : <li>{copy.leastShare(team.leastShareRatio)}</li>}
              {team.gini === null ? null : <li>{copy.gini(team.gini)}</li>}
              {lateCount > 0 ? <li>{copy.late(lateCount, thresholds.lateWindowPct)}</li> : null}
            </>
          )}
        </ul>
        <p className="type-small mt-3 text-fg-muted">{copy.notVisible}</p>
      </section>

      <section aria-labelledby="fairness-timeline">
        <h3 id="fairness-timeline" className="type-h3">
          {copy.timelineTitle}
        </h3>
        <Timeline
          className="mt-3"
          columns={result.weeks}
          series={visible.map((person) => ({ key: person.key, label: nameOf(person.key), values: person.weekly }))}
          label={copy.timelineLabel}
          seriesHeading={copy.personHeading}
        />
        <div className="type-small mt-3 flex flex-col gap-1 text-fg-muted">
          {result.excludedLines > 0 ? <p>{copy.excluded(result.excludedLines)}</p> : null}
          {result.coAuthorCredits > 0 ? <p>{copy.coAuthors(result.coAuthorCredits)}</p> : null}
        </div>
      </section>

      {unlinked.length > 0 && accounts.length > 0 ? (
        <section aria-labelledby="fairness-merge" data-testid="fairness-merge">
          <h3 id="fairness-merge" className="type-h3">
            {fairnessCopy.merge.title}
          </h3>
          <p className="type-small mt-1 text-fg-muted">{fairnessCopy.merge.line}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {unlinked.map((person) => (
              <li key={person.key}>
                <Select
                  label={`${fairnessCopy.merge.into(person.name)} (${fairnessCopy.merge.commits(person.commits)})`}
                  value={merges[person.key] ?? ''}
                  onChange={(event) => {
                    const target = event.target.value;
                    setMerges((current) => {
                      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== person.key));
                      return target === '' ? rest : { ...rest, [person.key]: target };
                    });
                  }}
                  options={[
                    { value: '', label: fairnessCopy.merge.keep },
                    ...accounts.map((account) => ({ value: account.key, label: account.login ?? account.name })),
                  ]}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
