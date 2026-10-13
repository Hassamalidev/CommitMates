import { EnvError } from '@commitmates/env';
import { assertWorkerEnv } from '@commitmates/env/worker';

import { runLoop } from './loop';

/** Process entry point. The job runner is attached to this loop in P1-T03. */
async function main(): Promise<void> {
  try {
    assertWorkerEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      controller.abort();
    });
  }

  console.info('Worker environment is valid. No job handlers are registered yet.');
  await runLoop({
    run: () => Promise.resolve(),
    intervalMs: () => WORKER_IDLE_INTERVAL_MS,
    signal: controller.signal,
    onError: (error) => {
      console.error(error);
    },
  });
}

/** Idle pause until the runner reads `jobs.workerIntervalMs` from settings (P1-T03). */
const WORKER_IDLE_INTERVAL_MS = 5000;

await main();
