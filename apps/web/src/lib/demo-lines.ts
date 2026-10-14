import type { TerminalLine } from '@commitmates/ui';

import { landingCopy } from '@/copy/landing';
import { toolsCopy } from '@/copy/tools';

import { minutesUntil, stepPosition, type JobState } from './job-state';

/**
 * The terminal transcript of a Dev Card run on the landing page (CLAUDE.md §9.6 step 2):
 * the command, one line per step reached, then how it ended. Derived from the job state
 * alone, so a reload or a late event can never leave stray lines behind.
 */
export function demoLines(
  login: string | null,
  state: JobState<unknown>,
  steps: readonly { key: string; label: string }[],
  now: Date,
): TerminalLine[] {
  const { demo } = landingCopy;
  if (login === null) return [{ type: 'info', text: demo.hint }];
  const lines: TerminalLine[] = [{ type: 'command', text: demo.command(login) }];
  const stepLines = (reached: number, finished: boolean) =>
    steps.slice(0, reached).map((step, index): TerminalLine => {
      const done = finished || index + 1 < reached;
      return { type: done ? 'success' : 'info', text: `${done ? '✓' : '›'} ${step.label}` };
    });

  switch (state.phase) {
    case 'idle':
      return lines;
    case 'working': {
      const position = stepPosition(steps, state.progress);
      if (position === null) return [...lines, { type: 'info', text: toolsCopy.job.queued }];
      return [...lines, ...stepLines(position, false)];
    }
    case 'waiting':
      return [
        ...lines,
        ...stepLines(stepPosition(steps, state.progress) ?? 0, false),
        { type: 'warn', text: toolsCopy.job.waiting(minutesUntil(state.until, now)) },
      ];
    case 'done':
      return [...lines, ...stepLines(steps.length, true), { type: 'success', text: demo.done }];
    case 'error':
      return [...lines, { type: 'error', text: state.message }];
  }
}
