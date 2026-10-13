import { serverEnv } from '@commitmates/env/server';

import { runMigrations } from './migrate';

await runMigrations(serverEnv.DIRECT_DATABASE_URL);
console.info('Migrations applied.');
