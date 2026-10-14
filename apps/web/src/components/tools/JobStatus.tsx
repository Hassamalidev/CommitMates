'use client';

import { CompanionView, SpeechBubble, StateChip, cn, type CompanionInput } from '@commitmates/ui';
import { useEffect, useState } from 'react';

import { toolsCopy } from '@/copy/tools';
import { brandCompanion } from '@/lib/brand';
import { companionStateFor, minutesUntil, stepPosition, type JobState } from '@/lib/job-state';

export type JobStep = { key: string; label: string };

export type JobStatusProps = {
  state: JobState<unknown>;
  /** The tool's steps in order; keys match the `step` its job reports. */
  steps: readonly JobStep[];
  /** What the companion says before anything has been asked. */
  idleLine: string;
  companion?: CompanionInput;
  className?: string;
};

const chipLabel = {
  idle: toolsCopy.job.idleChip,
  working: toolsCopy.job.workingChip,
  waiting: toolsCopy.job.waitingChip,
  done: toolsCopy.job.doneChip,
  error: toolsCopy.job.errorChip,
} as const;

/** How often the "back in about N min" estimate is refreshed. */
const ETA_REFRESH_MS = 15_000;

function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(new Date());
    }, ETA_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

function lineFor(state: JobState<unknown>, steps: readonly JobStep[], idleLine: string, now: Date): string {
  switch (state.phase) {
    case 'idle':
      return idleLine;
    case 'working': {
      const position = stepPosition(steps, state.progress);
      if (!state.progress || position === null) return state.progress?.message ?? toolsCopy.job.queued;
      const label = state.progress.message ?? steps[position - 1]?.label ?? toolsCopy.job.queued;
      return `${label} ${toolsCopy.job.stepOf(position, steps.length)}`;
    }
    case 'waiting':
      return toolsCopy.job.waiting(minutesUntil(state.until, now));
    case 'done':
      return toolsCopy.job.done;
    case 'error':
      return state.message;
  }
}

/**
 * The companion reporting on a tool run: one of five states, one short line, and the
 * step list while work is in flight (CLAUDE.md §5.14, §9.1).
 */
export function JobStatus({ state, steps, idleLine, companion = brandCompanion, className }: JobStatusProps) {
  const now = useNow(state.phase === 'waiting');
  const line = lineFor(state, steps, idleLine, now);
  const inFlight = state.phase === 'working' || state.phase === 'waiting';
  const position = inFlight ? stepPosition(steps, state.progress) : null;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-start gap-3">
        <CompanionView
          companion={companion}
          state={companionStateFor(state.phase)}
          size={96}
          label={toolsCopy.job.companionLabel(toolsCopy.job.states[state.phase])}
        />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <StateChip state={companionStateFor(state.phase)} label={chipLabel[state.phase]} />
          {state.phase === 'error' ? (
            <SpeechBubble tail="left">
              <span role="alert">{line}</span>
            </SpeechBubble>
          ) : (
            <SpeechBubble tail="left" live>
              {line}
            </SpeechBubble>
          )}
        </div>
      </div>
      {inFlight && steps.length > 0 ? (
        <ol aria-label={toolsCopy.job.stepsLabel} className="type-small flex flex-col gap-1 text-fg-muted">
          {steps.map((step, index) => {
            const current = position === index + 1;
            const finished = position !== null && index + 1 < position;
            return (
              <li
                key={step.key}
                aria-current={current ? 'step' : undefined}
                className={cn('flex items-center gap-2', current && 'text-fg', finished && 'text-state-done')}
              >
                <span aria-hidden="true" className="font-mono">
                  {finished ? '✓' : current ? '›' : '·'}
                </span>
                {step.label}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
