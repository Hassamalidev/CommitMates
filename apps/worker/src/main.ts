import { closeDb, getLogger, getSetting, registerAllHandlers, runTick } from '@commitmates/core';
import { EnvError } from '@commitmates/env';
import { assertWorkerEnv } from '@commitmates/env/worker';

import { runLoop } from './loop';

/** Process entry point: runs the job runner in a loop for local development and self-hosting. */
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

  const log = getLogger().child({ service: 'worker' });
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log.info({ signal }, 'stopping after the current tick');
      controller.abort();
    });
  }

  registerAllHandlers();
  log.info('worker started');
  await runLoop({
    run: async () => {
      const report = await runTick({ budgetMs: await getSetting('jobs.tickBudgetMs') });
      if (report.claimed > 0 || report.reaped > 0 || report.scheduled > 0) log.info(report, 'tick');
    },
    intervalMs: () => getSetting('jobs.workerIntervalMs'),
    signal: controller.signal,
    onError: (error) => {
      log.error({ err: error }, 'tick failed');
    },
  });
  await closeDb();
  log.info('worker stopped');
}

await main();
