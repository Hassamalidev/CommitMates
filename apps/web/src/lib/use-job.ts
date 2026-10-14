'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { toolsCopy } from '@/copy/tools';

import { IDLE, parseStartReply, parseStreamEvent, reduceJob, type JobAction, type JobState } from './job-state';

/** Stream event names sent by `/api/jobs/<id>/events`. */
const STREAM_EVENTS = ['progress', 'waiting', 'done', 'timeout'] as const;
/** Failed connection attempts in a row before giving up; the browser retries on its own in between. */
const MAX_CONNECTION_FAILURES = 5;

export type UseJob<R> = {
  state: JobState<R>;
  /** Starts a run with the tool's input. A run already on screen is replaced. */
  start: (input: unknown) => void;
  reset: () => void;
};

/**
 * Runs a day-one tool and follows its job (CLAUDE.md §5.3 steps 5–7): posts the input,
 * shows a cached result at once, otherwise listens to the job's event stream until it
 * is done or failed. `parseResult` validates the result; `null` means it is not usable.
 */
export function useJob<R>(tool: string, parseResult: (value: unknown) => R | null): UseJob<R> {
  const [state, dispatch] = useReducer(reduceJob<R>, IDLE as JobState<R>);
  const source = useRef<EventSource | null>(null);
  /** Increases with every run, so replies of a replaced run are ignored. */
  const run = useRef(0);
  const parse = useRef(parseResult);
  useEffect(() => {
    parse.current = parseResult;
  }, [parseResult]);

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
  }, []);

  useEffect(() => {
    const runs = run;
    return () => {
      runs.current += 1;
      close();
    };
  }, [close]);

  const finish = useCallback(
    (action: JobAction<R>) => {
      close();
      dispatch(action);
    },
    [close],
  );

  const finishWithResult = useCallback(
    (value: unknown) => {
      const result = parse.current(value);
      finish(result === null ? { type: 'error', message: toolsCopy.errors.unexpected } : { type: 'done', result });
    },
    [finish],
  );

  const listen = useCallback(
    (jobId: string, runId: number) => {
      let failures = 0;
      const open = () => {
        const events = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
        source.current = events;

        const handle = (name: string, data: string) => {
          if (run.current !== runId) return;
          failures = 0;
          const signal = parseStreamEvent(name, data);
          if (!signal) return;
          switch (signal.type) {
            case 'done':
              finishWithResult(signal.result);
              return;
            case 'error':
              finish({ type: 'error', message: signal.message });
              return;
            case 'reconnect':
              // The server ends each connection after a while; continue on a new one.
              events.close();
              open();
              return;
            default:
              dispatch(signal);
          }
        };

        for (const name of STREAM_EVENTS) {
          events.addEventListener(name, (event) => {
            handle(name, (event as MessageEvent<string>).data);
          });
        }
        // "error" is both a stream event of ours (it carries data) and the browser's
        // signal that the connection dropped (it carries none).
        events.addEventListener('error', (event) => {
          const data: unknown = (event as Partial<MessageEvent<unknown>>).data;
          if (typeof data === 'string') {
            handle('error', data);
            return;
          }
          if (run.current !== runId) return;
          failures += 1;
          if (failures >= MAX_CONNECTION_FAILURES) finish({ type: 'error', message: toolsCopy.errors.lostConnection });
        });
      };
      open();
    },
    [finish, finishWithResult],
  );

  const start = useCallback(
    (input: unknown) => {
      close();
      run.current += 1;
      const runId = run.current;
      dispatch({ type: 'submit' });

      void (async () => {
        let body: unknown;
        try {
          const response = await fetch(`/api/tools/${encodeURIComponent(tool)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
          body = await response.json();
        } catch {
          if (run.current === runId) finish({ type: 'error', message: toolsCopy.errors.network });
          return;
        }
        if (run.current !== runId) return;

        const reply = parseStartReply(body);
        if (!reply) {
          finish({ type: 'error', message: toolsCopy.errors.unexpected });
        } else if (reply.status === 'error') {
          finish({ type: 'error', message: reply.message, ...(reply.field !== undefined ? { field: reply.field } : {}) });
        } else if (reply.status === 'done') {
          finishWithResult(reply.result);
        } else {
          listen(reply.jobId, runId);
        }
      })();
    },
    [close, finish, finishWithResult, listen, tool],
  );

  const reset = useCallback(() => {
    run.current += 1;
    finish({ type: 'reset' });
  }, [finish]);

  return { state, start, reset };
}
