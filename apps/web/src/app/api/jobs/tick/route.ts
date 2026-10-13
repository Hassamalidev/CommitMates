import { getLogger, getSetting } from '@commitmates/core';
import { serverEnv } from '@commitmates/env/server';
import { NextResponse } from 'next/server';

import { runTickWithHandlers } from '@/server/jobs';
import { secretsMatch } from '@/server/secrets';

export const dynamic = 'force-dynamic';
/** Seconds the host may run this function; the tick budget setting must stay below it. */
export const maxDuration = 60;

/** Internal: called every minute by pg_cron with the shared secret (CLAUDE.md §5.4). */
export async function POST(request: Request): Promise<NextResponse> {
  if (!secretsMatch(request.headers.get('x-tick-secret'), serverEnv.JOB_TICK_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await runTickWithHandlers({ budgetMs: await getSetting('jobs.tickBudgetMs') });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    getLogger().error({ err: error }, 'tick failed');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
