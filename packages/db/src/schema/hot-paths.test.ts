import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { useTestDatabase, type TestDatabase } from '../testing';

/**
 * Performance audit (CLAUDE.md §11.6 "Database", P7-T02a): the hot-path queries never scan a large
 * table sequentially. The tables are filled with more than 10,000 rows of synthetic data, analyzed,
 * and each query's plan is checked with EXPLAIN. Every foreign key is also backed by an index (§7).
 */

let database: TestDatabase;
/** Rows per large table; above the 10,000 of §11.6. */
const ROWS = 20_000;
/** Repositories: the default `crawler.maxRepos`, the size the country index is allowed to reach. */
const REPOS = 200_000;

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };

function seqScans(node: PlanNode, found: string[] = []): string[] {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) found.push(node['Relation Name']);
  for (const child of node.Plans ?? []) seqScans(child, found);
  return found;
}

async function plan(query: string): Promise<string[]> {
  const [row] = await database.sql.unsafe<{ 'QUERY PLAN': { Plan: PlanNode }[] }[]>(`explain (format json) ${query}`);
  return seqScans(row!['QUERY PLAN'][0]!.Plan);
}

beforeAll(async () => {
  database = await useTestDatabase();
  const sql = database.sql;
  await sql`insert into auth.users (id) select gen_random_uuid() from generate_series(1, 500)`;
  await sql`insert into users (id) select id from auth.users on conflict do nothing`;
  await sql`create temporary table people as select id, row_number() over () as n from users`;
  await sql`insert into jobs (type, status, max_attempts, run_at)
            select 'probe', case when g % 400 = 0 then 'queued' else 'done' end::job_status, 1, now() - (g || ' seconds')::interval
            from generate_series(1, ${ROWS}) g`;
  await sql`insert into notifications (user_id, kind, read_at)
            select p.id, 'probe', case when g % 3 = 0 then null else now() end from generate_series(1, ${ROWS}) g join people p on p.n = 1 + g % 500`;
  await sql`insert into threads (kind) select 'direct' from generate_series(1, 200)`;
  await sql`insert into messages (thread_id, author_user_id, kind, body, created_at)
            select t.id, null, 'system', 'probe', now() - (g || ' seconds')::interval
            from generate_series(1, ${ROWS}) g join (select id, row_number() over () as n from threads) t on t.n = 1 + g % 200`;
  await sql`insert into gh_users (github_id, login, fetched_at, expires_at, in_country_index, index_country_code)
            select 1000000 + g, 'probe-user-' || g, now(), now() + interval '1 day', g % 2 = 0, case when g % 2 = 0 then 'TL' end from generate_series(1, ${ROWS}) g`;
  await sql`insert into gh_repos (github_id, owner_github_id, full_name, name, description, topics, primary_language, is_fork, fetched_at, expires_at)
            select 5000000 + g, 1000000 + 1 + g % ${ROWS}, 'probe-user-' || g || '/repo', 'repo', 'probe repository number ' || g, array['topic-' || (g % 500)], 'Go', false, now(), now() + interval '1 day'
            from generate_series(1, ${REPOS}) g`;
  await sql`insert into analysis_cache (kind, subject_key, params_hash, result, is_member_subject, computed_at, expires_at)
            select 'dev_card', 'login-' || g, 'p', '{}', false, now(), now() + (g || ' minutes')::interval from generate_series(1, ${ROWS}) g`;
  await sql`insert into api_cache (token_identity, method, url, status, fetched_at)
            select 'server', 'GET', '/repos/o/r' || g, 200, now() from generate_series(1, ${ROWS}) g`;
  await sql`insert into metric_samples (metric_key, value, subject_hash, salt_period, recorded_on)
            select 'persona.nightShare', g / 1000.0, 'h' || g, 1, current_date - (g % 300) from generate_series(1, ${ROWS}) g`;
  await sql`insert into audit_log (action, target_type, target_id) select 'probe', 'user', 'id-' || g from generate_series(1, ${ROWS}) g`;
  await sql`insert into rate_limit_buckets (key, tokens, updated_at) select 'tool:x:ip:' || g, 1, now() - (g || ' minutes')::interval from generate_series(1, ${ROWS}) g`;
  await sql`analyze`;
}, 300_000);

afterAll(async () => {
  await database.destroy();
});

describe('hot paths on large tables', () => {
  it('claims queued jobs and follows a job without scanning jobs', async () => {
    expect(await plan(`select id from jobs where status = 'queued' and run_at <= now() order by priority desc, run_at limit 3 for update skip locked`)).not.toContain('jobs');
    expect(await plan(`select * from jobs where id = '00000000-0000-4000-8000-000000000000'`)).not.toContain('jobs');
  });

  it('counts and lists a member’s notifications and pages a conversation by index', async () => {
    const [person] = await database.sql<{ id: string }[]>`select id from users limit 1`;
    expect(await plan(`select count(*) from notifications where user_id = '${person!.id}' and read_at is null`)).not.toContain('notifications');
    const [thread] = await database.sql<{ id: string }[]>`select id from threads limit 1`;
    expect(await plan(`select * from messages where thread_id = '${thread!.id}' order by created_at desc, id desc limit 50`)).not.toContain('messages');
  });

  it('reads caches by key and purges expired rows by index', async () => {
    expect(await plan(`select result from analysis_cache where kind = 'dev_card' and subject_key = 'login-5' and params_hash = 'p'`)).not.toContain('analysis_cache');
    expect(await plan(`select body from api_cache where token_identity = 'server' and method = 'GET' and url = '/repos/o/r5'`)).not.toContain('api_cache');
    expect(await plan(`delete from analysis_cache where expires_at < now() - interval '1 day'`)).not.toContain('analysis_cache');
    expect(await plan(`delete from gh_users where expires_at < now() - interval '1 day' and not is_member`)).not.toContain('gh_users');
  });

  it('finds GitHub users and repositories by login, owner and text', async () => {
    expect(await plan(`select github_id from gh_users where login = 'probe-user-5'`)).not.toContain('gh_users');
    expect(await plan(`select full_name from gh_repos where owner_github_id = 1000005`)).not.toContain('gh_repos');
    // The country scope of the Graveyard: full text or a topic of the expansion, within one country's index.
    const country = `select r.full_name from gh_repos r join gh_users u on u.github_id = r.owner_github_id
      where u.in_country_index and u.index_country_code = 'TL'
        and (r.search_tsv @@ websearch_to_tsquery('simple', '12345') or r.topics && array['topic-7', 'topic-9']::text[])
      limit 200`;
    expect(await plan(country)).not.toContain('gh_repos');
  });

  it('reads metric samples, the audit log and rate buckets by index', async () => {
    expect(await plan(`select value from metric_samples where metric_key = 'persona.nightShare' and recorded_on >= current_date - 30`)).not.toContain('metric_samples');
    // The audit log viewer pages by id (keyset).
    expect(await plan(`select * from audit_log where id < 15000 order by id desc limit 51`)).not.toContain('audit_log');
    expect(await plan(`select * from audit_log where target_type = 'user' and target_id = 'id-5'`)).not.toContain('audit_log');
    expect(await plan(`select tokens from rate_limit_buckets where key = 'tool:x:ip:5'`)).not.toContain('rate_limit_buckets');
  });
});

describe('foreign keys', () => {
  it('are each backed by an index whose leading columns are the key', async () => {
    const unindexed = await database.sql<{ tbl: string; conname: string }[]>`
      select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'public'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and c.conkey @> (i.indkey::int2[])[0:cardinality(c.conkey) - 1]
        )
      order by 1, 2`;
    expect(unindexed).toEqual([]);
  });
});
