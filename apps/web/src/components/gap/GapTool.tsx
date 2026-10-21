'use client';

import type { GapResult } from '@commitmates/core';
import { Button, Card, Input } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { gapCopy } from '@/copy/gap';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

import { GapView } from './GapView';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A structural check of a Gap Finder result that reached the browser; the server validated the full schema. */
export function parseGap(value: unknown): GapResult | null {
  if (!isRecord(value) || !isRecord(value.repo)) return null;
  const { gaps, shared, peers } = value;
  if (!Array.isArray(gaps) || !Array.isArray(shared) || !Array.isArray(peers)) return null;
  return gaps.every((gap) => isRecord(gap) && typeof gap.facet === 'string' && Array.isArray(gap.examples)) ? (value as GapResult) : null;
}

const IDLE: JobState<unknown> = { phase: 'idle' };

export type GapToolProps = { initialRepo?: string | undefined; campusMinMembers: number; signedIn?: boolean };

/** The Gap Finder: a repository in, what its successful neighbours have out. */
export function GapTool({ initialRepo, campusMinMembers, signedIn = false }: GapToolProps) {
  const { state, start } = useJob('gap', parseGap);
  const [repoUrl, setRepoUrl] = useState(initialRepo ?? '');

  useEffect(() => {
    if (initialRepo) start({ repoUrl: initialRepo });
  }, [initialRepo, start]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = repoUrl.trim();
    start({ repoUrl: value });
    window.history.replaceState(null, '', value ? `?repo=${encodeURIComponent(value)}` : window.location.pathname);
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = state.phase === 'error' && state.field === 'repoUrl' ? state.message : undefined;
  const result = state.phase === 'done' ? state.result : null;
  const { form } = gapCopy;

  return (
    <div className="flex flex-col gap-6">
      <Card title={form.title} className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Input
            className="flex-1"
            name="repoUrl"
            type="url"
            inputMode="url"
            label={form.label}
            description={form.description}
            error={fieldError}
            value={repoUrl}
            onChange={(event) => {
              setRepoUrl(event.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <Button type="submit" variant="primary" size="md" loading={busy} className="sm:mt-[26px]">
            {result ? form.again : form.submit}
          </Button>
        </form>
        <JobStatus state={fieldError ? IDLE : state} steps={gapCopy.steps} idleLine={gapCopy.idleLine} />
      </Card>
      {result ? <GapView result={result} campusMinMembers={campusMinMembers} signedIn={signedIn} /> : null}
    </div>
  );
}
