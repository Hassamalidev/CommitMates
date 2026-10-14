import { describe, expect, it } from 'vitest';

import {
  IDLE,
  companionStateFor,
  minutesUntil,
  parseStartReply,
  parseStreamEvent,
  reduceJob,
  stepPosition,
  type JobAction,
  type JobState,
} from './job-state';

type Result = { value: number };
const run = (actions: JobAction<Result>[], from: JobState<Result> = IDLE) => actions.reduce(reduceJob<Result>, from);

describe('reduceJob', () => {
  it('walks through all five phases of a run that has to wait', () => {
    const phases: string[] = [IDLE.phase];
    let state: JobState<Result> = IDLE;
    const actions: JobAction<Result>[] = [
      { type: 'submit' },
      { type: 'progress', queued: false, progress: { step: 'finding', pct: 25 } },
      { type: 'waiting', until: '2026-10-14T12:03:00.000Z', progress: null },
      { type: 'progress', queued: false, progress: { step: 'building' } },
      { type: 'done', result: { value: 7 } },
    ];
    for (const action of actions) {
      state = reduceJob(state, action);
      phases.push(state.phase);
    }
    expect(phases).toEqual(['idle', 'working', 'working', 'waiting', 'working', 'done']);
    expect(state).toEqual({ phase: 'done', result: { value: 7 } });

    expect(run([{ type: 'submit' }, { type: 'error', message: 'No such user.', field: 'login' }])).toEqual({
      phase: 'error',
      message: 'No such user.',
      field: 'login',
    });
  });

  it('keeps the last reported step while queued again or waiting', () => {
    const waiting = run([
      { type: 'submit' },
      { type: 'progress', queued: false, progress: { step: 'finding' } },
      { type: 'waiting', until: '2026-10-14T12:03:00.000Z', progress: null },
    ]);
    expect(waiting).toMatchObject({ phase: 'waiting', progress: { step: 'finding' } });
    expect(reduceJob(waiting, { type: 'progress', queued: true, progress: null })).toEqual({
      phase: 'working',
      queued: true,
      progress: { step: 'finding' },
    });
  });

  it('ignores late stream events once a run is finished or was never started', () => {
    const done: JobState<Result> = { phase: 'done', result: { value: 1 } };
    const failed: JobState<Result> = { phase: 'error', message: 'x' };
    for (const state of [done, failed, IDLE as JobState<Result>]) {
      expect(reduceJob(state, { type: 'progress', queued: false, progress: { step: 'late' } })).toBe(state);
      expect(reduceJob(state, { type: 'waiting', until: 'later', progress: null })).toBe(state);
    }
  });

  it('starts over on submit and reset', () => {
    const done: JobState<Result> = { phase: 'done', result: { value: 1 } };
    expect(reduceJob(done, { type: 'submit' })).toEqual({ phase: 'working', queued: true, progress: null });
    expect(reduceJob(done, { type: 'reset' })).toBe(IDLE);
  });
});

describe('companionStateFor', () => {
  it('maps each phase to the companion state of the same name', () => {
    for (const phase of ['idle', 'working', 'waiting', 'done', 'error'] as const) {
      expect(companionStateFor(phase)).toBe(phase);
    }
  });
});

describe('parseStartReply', () => {
  it('reads the three reply shapes', () => {
    expect(parseStartReply({ status: 'done', result: { a: 1 }, computedAt: 'x' })).toEqual({ status: 'done', result: { a: 1 } });
    expect(parseStartReply({ status: 'queued', jobId: 'abc' })).toEqual({ status: 'queued', jobId: 'abc' });
    expect(parseStartReply({ status: 'error', error: { code: 'c', message: 'Slow down.' } })).toEqual({
      status: 'error',
      message: 'Slow down.',
    });
    expect(parseStartReply({ status: 'error', error: { code: 'c', message: 'Bad login.', field: 'login' } })).toEqual({
      status: 'error',
      message: 'Bad login.',
      field: 'login',
    });
  });

  it('rejects anything else', () => {
    for (const body of [null, 'done', {}, { status: 'queued' }, { status: 'done' }, { status: 'error', error: {} }]) {
      expect(parseStartReply(body)).toBeNull();
    }
  });
});

describe('parseStreamEvent', () => {
  it('reads every event the job stream sends', () => {
    expect(parseStreamEvent('progress', '{"status":"queued","progress":null}')).toEqual({
      type: 'progress',
      queued: true,
      progress: null,
    });
    expect(
      parseStreamEvent('progress', '{"status":"running","progress":{"step":"repos","pct":40,"message":"Reading 42 repos…"}}'),
    ).toEqual({ type: 'progress', queued: false, progress: { step: 'repos', pct: 40, message: 'Reading 42 repos…' } });
    expect(parseStreamEvent('waiting', '{"until":"2026-10-14T12:03:00.000Z","progress":{"step":"repos"}}')).toEqual({
      type: 'waiting',
      until: '2026-10-14T12:03:00.000Z',
      progress: { step: 'repos' },
    });
    expect(parseStreamEvent('done', '{"result":{"score":80}}')).toEqual({ type: 'done', result: { score: 80 } });
    expect(parseStreamEvent('done', '{}')).toEqual({ type: 'done', result: null });
    expect(parseStreamEvent('error', '{"message":"Not found."}')).toEqual({ type: 'error', message: 'Not found.' });
    expect(parseStreamEvent('timeout', '{}')).toEqual({ type: 'reconnect' });
  });

  it('drops malformed frames', () => {
    expect(parseStreamEvent('progress', 'not json')).toBeNull();
    expect(parseStreamEvent('progress', '42')).toBeNull();
    expect(parseStreamEvent('waiting', '{}')).toBeNull();
    expect(parseStreamEvent('error', '{}')).toBeNull();
    expect(parseStreamEvent('other', '{}')).toBeNull();
    expect(parseStreamEvent('progress', '{"status":"running","progress":{"pct":1}}')).toMatchObject({ progress: null });
  });
});

describe('minutesUntil', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');

  it('rounds up and never goes below one', () => {
    expect(minutesUntil('2026-10-14T12:02:10.000Z', now)).toBe(3);
    expect(minutesUntil('2026-10-14T12:00:20.000Z', now)).toBe(1);
    expect(minutesUntil('2026-10-14T11:00:00.000Z', now)).toBe(1);
    expect(minutesUntil('garbage', now)).toBe(1);
  });
});

describe('stepPosition', () => {
  const steps = [{ key: 'finding' }, { key: 'repos' }, { key: 'building' }];

  it('is 1-based and null for unknown or missing steps', () => {
    expect(stepPosition(steps, { step: 'repos' })).toBe(2);
    expect(stepPosition(steps, { step: 'other' })).toBeNull();
    expect(stepPosition(steps, null)).toBeNull();
  });
});
