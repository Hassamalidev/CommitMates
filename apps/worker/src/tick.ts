import { closeDb, getSetting, registerAllHandlers, runTick } from '@commitmates/core';

// A single tick, for debugging (`pnpm jobs:tick`).
registerAllHandlers();
const report = await runTick({ budgetMs: await getSetting('jobs.tickBudgetMs') });
console.info(JSON.stringify(report, null, 2));
await closeDb();
