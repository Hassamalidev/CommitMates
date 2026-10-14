'use client';

import { Button, Card, Input } from '@commitmates/ui';
import { useEffect, useState, type SubmitEvent } from 'react';

import { JobStatus } from '@/components/tools/JobStatus';
import { compatCopy } from '@/copy/compat';
import { parseCompat } from '@/lib/compat';
import type { JobState } from '@/lib/job-state';
import { useJob } from '@/lib/use-job';

import { CompatView } from './CompatView';

export type CompatToolProps = {
  /** Both logins from the address: the comparison runs right away. */
  initial?: { a: string; b: string } | undefined;
  /** The signed-in member's login, prefilled as the first person. */
  memberLogin?: string | undefined;
};

const IDLE: JobState<unknown> = { phase: 'idle' };

/** The Compatibility Check: two usernames in, the companion reporting progress, the breakdown out. */
export function CompatTool({ initial, memberLogin }: CompatToolProps) {
  const { state, start } = useJob('compat', parseCompat);
  const [a, setA] = useState(initial?.a ?? memberLogin ?? '');
  const [b, setB] = useState(initial?.b ?? '');

  const initialA = initial?.a;
  const initialB = initial?.b;
  useEffect(() => {
    if (initialA && initialB) start({ a: initialA, b: initialB });
  }, [initialA, initialB, start]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pair = { a: a.trim(), b: b.trim() };
    start(pair);
    const query = new URLSearchParams(pair).toString();
    // The address then names the comparison, so it can be reloaded.
    window.history.replaceState(null, '', `?${query}`);
  };

  const busy = state.phase === 'working' || state.phase === 'waiting';
  const fieldError = (field: 'a' | 'b') => (state.phase === 'error' && state.field === field ? state.message : undefined);
  const hasFieldError = state.phase === 'error' && (state.field === 'a' || state.field === 'b');
  const result = state.phase === 'done' ? state.result : null;

  return (
    <div className="flex flex-col gap-6">
      <Card title={compatCopy.form.title} className="flex flex-col gap-6">
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
          {(['a', 'b'] as const).map((field) => (
            <Input
              key={field}
              name={field}
              label={field === 'a' ? compatCopy.form.labelA : compatCopy.form.labelB}
              description={field === 'a' ? compatCopy.form.descriptionA : undefined}
              error={fieldError(field)}
              value={field === 'a' ? a : b}
              onChange={(event) => {
                (field === 'a' ? setA : setB)(event.target.value);
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={40}
              required
            />
          ))}
          <Button type="submit" variant="primary" size="md" loading={busy} className="sm:mt-[26px]">
            {result ? compatCopy.form.again : compatCopy.form.submit}
          </Button>
        </form>
        {/* A field error is shown next to its field; the companion stays calm. */}
        <JobStatus state={hasFieldError ? IDLE : state} steps={compatCopy.steps} idleLine={compatCopy.idleLine} />
      </Card>
      {result ? <CompatView result={result} /> : null}
    </div>
  );
}
