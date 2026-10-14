'use client';

import { Button, Card, Input } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { fairnessCopy } from '@/copy/fairness';
import { parseFairness, type FairnessThresholds } from '@/lib/fairness';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

import { FairnessView } from './FairnessView';

export type FairnessToolProps = { initialRepo?: string | undefined; thresholds: FairnessThresholds };

const IDLE: JobState<unknown> = { phase: 'idle' };

/** The Group Fairness Report: a repository link in, a neutral contribution report out. */
export function FairnessTool({ initialRepo, thresholds }: FairnessToolProps) {
  const { state, start } = useJob('fairness', parseFairness);
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
  const { form } = fairnessCopy;

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
        <JobStatus state={fieldError ? IDLE : state} steps={fairnessCopy.steps} idleLine={fairnessCopy.idleLine} />
      </Card>
      {result ? <FairnessView result={result} thresholds={thresholds} /> : null}
    </div>
  );
}
