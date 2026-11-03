'use client';

import type { IdeaCheck, UniversityMatch } from '@commitmates/core';
import { Button, Card, Chip, Input, Textarea } from '@commitmates/ui';
import { useState, useTransition } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { fypCopy } from '@/copy/fyp';
import { fypBoardCopy } from '@/copy/fyp-board';
import { useJob } from '@/lib/use-job';
import type { ActionResult } from '@/server/action';

import { parseFyp } from './FypTool';

/** How many worldwide results the composer shows; the Idea Checker shows them all. */
const WORLDWIDE_SHOWN = 5;

export type IdeaComposerProps = {
  limits: { titleMax: number; descriptionMin: number; descriptionMax: number };
  canPostAsSupervisor: boolean;
  check: (input: { title: string; description: string }) => Promise<ActionResult<IdeaCheck>>;
  post: (input: {
    title: string;
    description: string;
    supervisorIdea: boolean;
  }) => Promise<ActionResult<null>>;
};

/** Past projects closest to an idea, with band and similarity. */
export function MatchList({ matches, label }: { matches: readonly UniversityMatch[]; label: string }) {
  const copy = fypBoardCopy.match;
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {matches.map((match) => (
        <li key={match.projectId} className="rounded-control border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {match.fullName ? (
              <a
                href={`https://github.com/${match.fullName}`}
                rel="noreferrer"
                className="type-small text-accent underline underline-offset-4 break-all"
              >
                {match.fullName}
              </a>
            ) : null}
            <span className="type-small font-mono text-fg-muted">
              {copy.band[match.band]} · {copy.similarity(match.similarity)}
            </span>
          </div>
          {match.description ? <p className="type-small mt-1 text-fg-muted">{match.description}</p> : null}
          {match.year !== null ? <p className="type-small mt-1">{copy.year(match.year)}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Posting an idea (CLAUDE.md §8 F22 "Ideas"): check it against the university's past projects
 * (and worldwide, on request) before posting, then post it.
 */
export function IdeaComposer({ limits, canPostAsSupervisor, check, post }: IdeaComposerProps) {
  const copy = fypBoardCopy.post;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [supervisorIdea, setSupervisorIdea] = useState(false);
  const [result, setResult] = useState<IdeaCheck | null>(null);
  const [error, setError] = useState<{ message: string; field?: string | undefined } | null>(null);
  const [pending, startTransition] = useTransition();
  const worldwide = useJob('fyp-check', parseFyp);
  const input = () => ({ title: title.trim(), description: description.trim() });

  const run = (action: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      await action();
    });
  };
  const onCheck = () => {
    run(async () => {
      const outcome = await check(input());
      if (outcome.ok) setResult(outcome.data);
      else setError(outcome.error);
    });
  };
  const onPost = () => {
    run(async () => {
      const outcome = await post({ ...input(), supervisorIdea });
      if (!outcome.ok) setError(outcome.error);
    });
  };
  const fieldError = (name: string) => (error?.field === name ? error.message : undefined);
  const global = worldwide.state.phase === 'done' ? worldwide.state.result : null;

  return (
    <Card title={copy.title} titleAs="h2" className="flex flex-col gap-4">
      <p className="type-small text-fg-muted">{copy.intro}</p>
      <Input
        label={copy.name}
        name="title"
        value={title}
        maxLength={limits.titleMax}
        error={fieldError('title')}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        required
      />
      <Textarea
        label={copy.description}
        name="description"
        rows={5}
        value={description}
        maxLength={limits.descriptionMax}
        description={copy.descriptionHelp(limits.descriptionMin, limits.descriptionMax)}
        error={fieldError('description')}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        required
      />
      {canPostAsSupervisor ? (
        <label className="type-small flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={supervisorIdea}
            onChange={(event) => {
              setSupervisorIdea(event.target.checked);
            }}
            className="size-4 accent-accent"
          />
          {copy.supervisorIdea}
        </label>
      ) : null}
      {error && error.field === undefined ? (
        <p role="alert" className="type-small text-state-error">
          {error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={pending && result === null}
          onClick={onCheck}
        >
          {copy.check}
        </Button>
        {result ? (
          <Button type="button" variant="primary" size="md" loading={pending} onClick={onPost}>
            {copy.post}
          </Button>
        ) : null}
      </div>

      {result ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          {result.keyphrases.length > 0 ? (
            <div>
              <h3 className="type-small font-semibold">{copy.keyphrases}</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {result.keyphrases.map((phrase) => (
                  <li key={phrase}>
                    <Chip>{phrase}</Chip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className="type-small font-semibold">{copy.university}</h3>
            {result.university === null ? (
              <p className="type-small text-fg-muted">{copy.noCorpus}</p>
            ) : (
              <MatchList matches={result.university} label={copy.university} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                worldwide.start(input());
              }}
            >
              {copy.worldwide}
            </Button>
            <JobStatus state={worldwide.state} steps={fypCopy.steps} idleLine={fypCopy.idleLine} />
            {global ? (
              <ul className="flex flex-col gap-2" aria-label={copy.worldwide}>
                {global.results.slice(0, WORLDWIDE_SHOWN).map((entry) => (
                  <li key={entry.fullName} className="type-small flex flex-wrap justify-between gap-2">
                    <a
                      href={`https://github.com/${entry.fullName}`}
                      rel="noreferrer"
                      className="text-accent underline underline-offset-4 break-all"
                    >
                      {entry.fullName}
                    </a>
                    <span className="font-mono text-fg-muted">
                      {fypCopy.result.similarity(entry.similarity)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
