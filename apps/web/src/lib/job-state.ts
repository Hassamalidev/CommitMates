import type { CompanionState } from '@commitmates/ui';

/** Progress a job reports while it runs (`jobs.progress`). */
export type JobProgress = { step: string; pct?: number; message?: string };

/**
 * What the visitor sees for one tool run. The five phases are the companion's five
 * states (CLAUDE.md §5.3 step 7, §5.14).
 */
export type JobState<R> =
  | { phase: 'idle' }
  | { phase: 'working'; queued: boolean; progress: JobProgress | null }
  | { phase: 'waiting'; until: string; progress: JobProgress | null }
  | { phase: 'done'; result: R }
  | { phase: 'error'; message: string; field?: string };

export type JobPhase = JobState<unknown>['phase'];

export type JobAction<R> =
  | { type: 'submit' }
  | { type: 'progress'; queued: boolean; progress: JobProgress | null }
  | { type: 'waiting'; until: string; progress: JobProgress | null }
  | { type: 'done'; result: R }
  | { type: 'error'; message: string; field?: string }
  | { type: 'reset' };

export const IDLE: JobState<never> = { phase: 'idle' };

/** The companion state for a phase. They share names by design; this keeps the mapping typed. */
export const companionStateFor = (phase: JobPhase): CompanionState => phase;

export function reduceJob<R>(state: JobState<R>, action: JobAction<R>): JobState<R> {
  switch (action.type) {
    case 'reset':
      return IDLE;
    case 'submit':
      return { phase: 'working', queued: true, progress: null };
    case 'done':
      return { phase: 'done', result: action.result };
    case 'error':
      return { phase: 'error', message: action.message, ...(action.field !== undefined ? { field: action.field } : {}) };
    case 'progress':
    case 'waiting': {
      // A finished run stays finished: late stream events must not reopen it.
      if (state.phase !== 'working' && state.phase !== 'waiting') return state;
      // A queued or waiting job may not have reported yet; keep the last step on screen.
      const progress = action.progress ?? state.progress;
      return action.type === 'waiting'
        ? { phase: 'waiting', until: action.until, progress }
        : { phase: 'working', queued: action.queued, progress };
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function parseProgress(value: unknown): JobProgress | null {
  if (!isRecord(value) || typeof value.step !== 'string') return null;
  return {
    step: value.step,
    ...(typeof value.pct === 'number' ? { pct: value.pct } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

/** The reply of `POST /api/tools/<tool>`. */
export type StartReply =
  | { status: 'done'; result: unknown }
  | { status: 'queued'; jobId: string }
  | { status: 'error'; message: string; field?: string };

export function parseStartReply(body: unknown): StartReply | null {
  if (!isRecord(body)) return null;
  if (body.status === 'done' && 'result' in body) return { status: 'done', result: body.result };
  if (body.status === 'queued' && typeof body.jobId === 'string') return { status: 'queued', jobId: body.jobId };
  if (body.status === 'error' && isRecord(body.error) && typeof body.error.message === 'string') {
    const { message, field } = body.error;
    return { status: 'error', message, ...(typeof field === 'string' ? { field } : {}) };
  }
  return null;
}

/** A frame from `GET /api/jobs/<id>/events`, already split into its name and JSON text. */
export type StreamSignal =
  | { type: 'progress'; queued: boolean; progress: JobProgress | null }
  | { type: 'waiting'; until: string; progress: JobProgress | null }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string }
  /** The connection's lifetime is over; open a new one. */
  | { type: 'reconnect' };

export function parseStreamEvent(name: string, dataText: string): StreamSignal | null {
  let data: unknown;
  try {
    data = JSON.parse(dataText);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (name) {
    case 'progress':
      return { type: 'progress', queued: data.status === 'queued', progress: parseProgress(data.progress) };
    case 'waiting':
      return typeof data.until === 'string' ? { type: 'waiting', until: data.until, progress: parseProgress(data.progress) } : null;
    case 'done':
      return { type: 'done', result: data.result ?? null };
    case 'error':
      return typeof data.message === 'string' ? { type: 'error', message: data.message } : null;
    case 'timeout':
      return { type: 'reconnect' };
    default:
      return null;
  }
}

const MS_PER_MINUTE = 60_000;

/** Whole minutes until `until`, never less than one: "back in about 3 min". */
export function minutesUntil(until: string, now: Date): number {
  const ms = new Date(until).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / MS_PER_MINUTE)) : 1;
}

/** Position of the current step in a tool's step list, 1-based; `null` before the first report. */
export function stepPosition(steps: readonly { key: string }[], progress: JobProgress | null): number | null {
  if (!progress) return null;
  const index = steps.findIndex((step) => step.key === progress.step);
  return index === -1 ? null : index + 1;
}
