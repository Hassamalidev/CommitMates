export type LoopOptions = {
  /** Work to do on each iteration. A rejection is reported and the loop keeps going. */
  run: () => Promise<void>;
  /** Pause between the end of one iteration and the start of the next. */
  intervalMs: () => number | Promise<number>;
  /** Stops the loop after the iteration in flight. */
  signal: AbortSignal;
  onError: (error: unknown) => void;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `run` repeatedly, never overlapping iterations, until the signal aborts.
 * Resolves with the number of completed iterations.
 */
export async function runLoop(options: LoopOptions): Promise<number> {
  const { run, intervalMs, signal, onError } = options;
  let iterations = 0;
  while (!signal.aborted) {
    try {
      await run();
    } catch (error) {
      onError(error);
    }
    iterations += 1;
    await sleep(await intervalMs(), signal);
  }
  return iterations;
}
