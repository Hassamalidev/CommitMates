import 'server-only';

import { getLogger, getSetting, registerAllHandlers, runTick, type TickReport } from '@commitmates/core';
import { after } from 'next/server';

/** Runs one tick with every handler registered. */
export async function runTickWithHandlers(options: { budgetMs: number; onlyJobId?: string }): Promise<TickReport> {
  registerAllHandlers();
  return runTick(options);
}

/**
 * Starts a job right after the response is sent, so a waiting user does not depend
 * on the next cron tick (CLAUDE.md §5.3 step 5). Failures are logged; the cron tick retries.
 */
export function startJobAfterResponse(jobId: string): void {
  after(async () => {
    try {
      await runTickWithHandlers({ budgetMs: await getSetting('jobs.interactiveBudgetMs'), onlyJobId: jobId });
    } catch (error) {
      getLogger().error({ err: error, jobId }, 'interactive job run failed');
    }
  });
}
