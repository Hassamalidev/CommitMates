import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { enqueue, runTick } from '@commitmates/jobs';
import { queueLocation } from '@commitmates/sources';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

const server = createMswServer();
let database: TestDatabase;

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});

describe('geocode_pending job', () => {
  it('is scheduled every minute by a migration', async () => {
    const rows = await database.sql`select cron_expr, job_type, enabled from job_schedules where name = 'geocode-pending'`;
    expect(rows).toEqual([{ cron_expr: '* * * * *', job_type: 'geocode_pending', enabled: true }]);
  });

  it('resolves queued locations through the queue and reports the counts', async () => {
    server.use(
      http.get('https://nominatim.openstreetmap.org/search', () =>
        HttpResponse.json([{ lat: '52.5170365', lon: '13.3888599', importance: 0.85, address: { city: 'Berlin', country_code: 'de' } }]),
      ),
    );
    await queueLocation('Berlin, Germany');
    await queueLocation('Internet');

    registerAllHandlers();
    const job = await enqueue('geocode_pending', {});
    const report = await runTick({ budgetMs: 30_000, onlyJobId: job.id });
    expect(report.done).toBe(1);

    const [row] = await database.sql`select status, result_ref from jobs where id = ${job.id}`;
    expect(row).toMatchObject({ status: 'done', result_ref: { resolved: 1, unresolvable: 0, failed: 0 } });
    const rows = await database.sql`select query_norm, status, city, country_code, timezone from geocode_cache order by query_norm`;
    expect(rows).toEqual([
      { query_norm: 'berlin, germany', status: 'resolved', city: 'Berlin', country_code: 'DE', timezone: 'Europe/Berlin' },
      { query_norm: 'internet', status: 'unresolvable', city: null, country_code: null, timezone: null },
    ]);
  });
});
