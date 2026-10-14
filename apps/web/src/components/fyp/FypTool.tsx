'use client';

import type { FypResult } from '@commitmates/core';
import { Button, Card, Chip, Input, Textarea } from '@commitmates/ui';
import { useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { fypCopy } from '@/copy/fyp';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a result that reached the browser; the server validated the full schema. */
export function parseFyp(value: unknown): FypResult | null {
  if (!isRecord(value) || !Array.isArray(value.keyphrases) || !Array.isArray(value.results) || !Array.isArray(value.unique)) return null;
  return value.results.every((result) => isRecord(result) && typeof result.fullName === 'string' && typeof result.similarity === 'number')
    ? (value as FypResult)
    : null;
}

/** Band order on the page, closest first. */
const BAND_ORDER = ['very-similar', 'related', 'loose'] as const;

const IDLE: JobState<unknown> = { phase: 'idle' };

export type FypToolProps = { limits: { titleMax: number; descriptionMin: number; descriptionMax: number } };

/** The FYP Idea Checker (CLAUDE.md §8 F9 "UI"): an idea in, similar projects by band and what is unique out. */
export function FypTool({ limits }: FypToolProps) {
  const { state, start } = useJob('fyp-check', parseFyp);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const { form, result: copy } = fypCopy;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    start({ title: title.trim(), description: description.trim() });
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = (field: string) => (state.phase === 'error' && state.field === field ? state.message : undefined);
  const hasFieldError = state.phase === 'error' && state.field !== undefined;
  const result = state.phase === 'done' ? state.result : null;

  return (
    <div className="flex flex-col gap-6">
      <Card title={form.title} className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Input
            name="title"
            label={form.titleLabel}
            error={fieldError('title')}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            maxLength={limits.titleMax}
            required
          />
          <Textarea
            name="description"
            label={form.descriptionLabel}
            description={form.descriptionHelp(description.trim().length, limits.descriptionMin, limits.descriptionMax)}
            error={fieldError('description')}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            maxLength={limits.descriptionMax}
            rows={6}
            required
          />
          <Button type="submit" variant="primary" size="md" loading={busy} className="self-start">
            {result ? form.again : form.submit}
          </Button>
        </form>
        <JobStatus state={hasFieldError ? IDLE : state} steps={fypCopy.steps} idleLine={fypCopy.idleLine} />
      </Card>

      {result ? (
        <Card as="article" aria-label={fypCopy.page.title} data-testid="fyp-result" className="flex flex-col gap-6">
          <section aria-labelledby="fyp-keyphrases">
            <h2 id="fyp-keyphrases" className="type-h3">
              {copy.keyphrasesTitle}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {result.keyphrases.map((phrase) => (
                <li key={phrase}>
                  <Chip>{phrase}</Chip>
                </li>
              ))}
            </ul>
          </section>

          {result.results.length === 0 ? <p className="type-body">{copy.none}</p> : null}
          {BAND_ORDER.map((band) => {
            const entries = result.results.filter((entry) => entry.band === band);
            if (entries.length === 0) return null;
            return (
              <section key={band} aria-labelledby={`fyp-band-${band}`}>
                <h2 id={`fyp-band-${band}`} className="type-h3">
                  {copy.bands[band]}
                </h2>
                <ul className="mt-2 flex flex-col gap-3">
                  {entries.map((entry) => (
                    <li key={entry.fullName} className="rounded-control border border-line bg-surface-2 p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <a href={`https://github.com/${entry.fullName}`} rel="noreferrer" className="type-body text-accent underline underline-offset-4 break-all">
                          {entry.fullName}
                        </a>
                        <span className="type-small font-mono text-fg-muted">{copy.similarity(entry.similarity)}</span>
                      </div>
                      {entry.description ? <p className="type-small mt-1 text-fg-muted">{entry.description}</p> : null}
                      {entry.sharedKeyphrases.length > 0 ? (
                        <p className="type-small mt-1">
                          {copy.shared} {entry.sharedKeyphrases.join(', ')}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section aria-labelledby="fyp-different">
            <h2 id="fyp-different" className="type-h3">
              {copy.differentTitle}
            </h2>
            {result.unique.length === 0 ? (
              <p className="type-small mt-1 text-fg-muted">{copy.differentNone}</p>
            ) : (
              <>
                <p className="type-small mt-1 text-fg-muted">{copy.differentLine}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {result.unique.map((phrase) => (
                    <li key={phrase}>
                      <Chip>{phrase}</Chip>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </Card>
      ) : null}
    </div>
  );
}
