import { createMswServer } from '@commitmates/config/testing/msw';
import { setLogger } from '@commitmates/db';
import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { runTick } from '@commitmates/jobs';
import { HttpResponse, http } from 'msw';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../handlers';

import { requestEnrichment } from './jobs';

const server = createMswServer();
let database: TestDatabase;
const NOW = new Date('2026-10-14T12:00:00.000Z');

beforeAll(async () => {
  setLogger(pino({ level: 'silent' }));
  database = await useTestDatabase();
  registerAllHandlers();
});
afterAll(async () => {
  await database.destroy();
  setLogger(undefined);
});
beforeEach(async () => {
  await database.sql`truncate jobs, package_meta, registry_pacing cascade`;
});

describe('requestEnrichment', () => {
  it('queues one job per stale package and month, at member-background priority', async () => {
    await database.sql`insert into package_meta (ecosystem, name, keywords, classifiers, gh_topics, derived_tags, fetched_at, expires_at)
                       values ('npm', 'react', '{}', '{}', '{}', '{}', ${NOW}, ${new Date(NOW.getTime() + 86_400_000)})`;
    const packages = [
      { ecosystem: 'npm', name: 'react' },
      { ecosystem: 'npm', name: 'zod' },
      { ecosystem: 'crates', name: 'serde' },
    ] as const;

    expect(await requestEnrichment(packages, NOW)).toBe(2);
    expect(await requestEnrichment(packages, NOW)).toBe(2);

    const jobs = await database.sql`select type, payload, priority, idempotency_key from jobs order by idempotency_key`;
    expect(jobs).toEqual([
      { type: 'enrich_packages', payload: { ecosystem: 'crates', name: 'serde' }, priority: 50, idempotency_key: 'pkg:crates:serde:2026-10' },
      { type: 'enrich_packages', payload: { ecosystem: 'npm', name: 'zod' }, priority: 50, idempotency_key: 'pkg:npm:zod:2026-10' },
    ]);
  });
});

describe('enrich_packages job', () => {
  it('enriches a package through the queue', async () => {
    server.use(
      http.get('https://crates.io/api/v1/crates/serde', () =>
        HttpResponse.json({ crate: { keywords: ['serialization'], categories: ['encoding'], repository: null } }),
      ),
    );
    await requestEnrichment([{ ecosystem: 'crates', name: 'serde' }]);
    const [job] = await database.sql<{ id: string }[]>`select id from jobs`;
    // Only this job: a plain tick would also run every due schedule.
    const report = await runTick({ budgetMs: 30_000, onlyJobId: job!.id });
    expect(report.done).toBe(1);
    const [row] = await database.sql`select derived_tags from package_meta where ecosystem = 'crates' and name = 'serde'`;
    expect(row!.derived_tags).toEqual(['encoding', 'serialization']);
  });

  it('kills a job with an unknown ecosystem instead of calling out', async () => {
    const [job] = await database.sql<{ id: string }[]>`
      insert into jobs (type, payload, max_attempts) values ('enrich_packages', '{"ecosystem":"cpan","name":"x"}', 3) returning id`;
    const report = await runTick({ budgetMs: 30_000, onlyJobId: job!.id });
    expect(report.dead).toBe(1);
  });
});
