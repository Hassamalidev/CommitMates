import postgres from 'postgres';
import { z } from 'zod';

/**
 * Turns the production job trigger on or off in a Supabase database (CLAUDE.md §5.4 "Production
 * trigger", docs/runbooks/deploy.md): pg_cron calls the tick route every minute through pg_net,
 * reading the URL and the shared secret from Supabase Vault so neither appears in SQL or in logs.
 * It lives outside the migrations because it must never run against a database without a deployed
 * site to call.
 *
 * Usage: pnpm db:tick enable | disable | status
 * Environment: DIRECT_DATABASE_URL (the target database), JOB_TICK_SECRET (the same value as the
 * site's), and TICK_URL or NEXT_PUBLIC_SITE_URL (the tick route is <site>/api/jobs/tick).
 */

/** The pg_cron job's name; one per database. */
const JOB_NAME = 'jobs-tick';
/** Every minute (§5.4). */
const SCHEDULE = '* * * * *';
/** Vault secret names the schedule reads (§5.4). */
const URL_SECRET = 'tick_url';
const TOKEN_SECRET = 'tick_secret';
/** pg_net gives up on the call after this long; the tick itself keeps running on the site. */
const REQUEST_TIMEOUT_MS = 5000;
/** Recent runs shown by `status`. */
const RECENT_RUNS = 5;

const command = z.enum(['enable', 'disable', 'status']).safeParse(process.argv[2]);
if (!command.success) {
  console.error('Usage: pnpm db:tick enable | disable | status');
  process.exit(1);
}

const env = z
  .object({
    DIRECT_DATABASE_URL: z.string().min(1, 'DIRECT_DATABASE_URL is required: the database to configure.'),
    JOB_TICK_SECRET: z.string().optional(),
    TICK_URL: z.url().optional(),
    NEXT_PUBLIC_SITE_URL: z.url().optional(),
  })
  .parse(process.env);

const sql = postgres(env.DIRECT_DATABASE_URL, { prepare: false, max: 1, onnotice: () => undefined });

/** Creates or replaces a Vault secret by name, without the value ever leaving this process. */
async function putSecret(name: string, value: string): Promise<void> {
  const [existing] = await sql<{ id: string }[]>`select id from vault.secrets where name = ${name}`;
  if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${value})`;
  else await sql`select vault.create_secret(${value}, ${name})`;
}

async function unschedule(): Promise<boolean> {
  const [job] = await sql<{ jobid: number }[]>`select jobid from cron.job where jobname = ${JOB_NAME}`;
  if (!job) return false;
  await sql`select cron.unschedule(${JOB_NAME})`;
  return true;
}

async function enable(): Promise<void> {
  const secret = env.JOB_TICK_SECRET;
  if (!secret) throw new Error('JOB_TICK_SECRET is required: the same value the site uses.');
  const site = env.TICK_URL ?? (env.NEXT_PUBLIC_SITE_URL ? new URL('/api/jobs/tick', env.NEXT_PUBLIC_SITE_URL).toString() : undefined);
  if (!site) throw new Error('Set TICK_URL, or NEXT_PUBLIC_SITE_URL to the deployed site.');

  await sql`create extension if not exists pg_cron`;
  await sql`create extension if not exists pg_net`;
  await putSecret(URL_SECRET, site);
  await putSecret(TOKEN_SECRET, secret);
  await unschedule();
  // The command is the one in CLAUDE.md §5.4; it reads both values from Vault at every run.
  await sql`select cron.schedule(${JOB_NAME}, ${SCHEDULE}, ${`
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = '${URL_SECRET}'),
      headers := jsonb_build_object(
        'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = '${TOKEN_SECRET}')),
      timeout_milliseconds := ${REQUEST_TIMEOUT_MS}
    );`})`;
  console.info(`Scheduled ${JOB_NAME} every minute, calling ${new URL(site).origin}/… with the secret from Vault.`);
}

async function disable(): Promise<void> {
  const removed = await unschedule();
  await sql`delete from vault.secrets where name in (${URL_SECRET}, ${TOKEN_SECRET})`;
  console.info(removed ? `Removed ${JOB_NAME} and its Vault secrets.` : `${JOB_NAME} was not scheduled; Vault secrets removed if present.`);
}

async function status(): Promise<void> {
  const [cron] = await sql<{ installed: boolean }[]>`select exists (select 1 from pg_extension where extname = 'pg_cron') as installed`;
  if (!cron?.installed) {
    console.info('pg_cron is not installed: the tick is off.');
    return;
  }
  const [job] = await sql<{ schedule: string; active: boolean }[]>`select schedule, active from cron.job where jobname = ${JOB_NAME}`;
  if (!job) {
    console.info(`${JOB_NAME} is not scheduled: the tick is off.`);
    return;
  }
  console.info(`${JOB_NAME}: schedule "${job.schedule}", ${job.active ? 'active' : 'inactive'}.`);
  const runs = await sql<{ status: string; start_time: Date; return_message: string | null }[]>`
    select d.status, d.start_time, d.return_message from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid where j.jobname = ${JOB_NAME}
    order by d.start_time desc limit ${RECENT_RUNS}`;
  for (const run of runs) console.info(`  run ${run.start_time.toISOString()}: ${run.status}${run.return_message ? ` (${run.return_message})` : ''}`);
  // pg_net keeps the HTTP responses for a while: the tick route answers 200 when the secret matched.
  const responses = await sql<{ status_code: number | null; created: Date; error_msg: string | null }[]>`
    select status_code, created, error_msg from net._http_response order by created desc limit ${RECENT_RUNS}`;
  for (const response of responses) {
    console.info(`  response ${response.created.toISOString()}: ${response.status_code ?? 'none'}${response.error_msg ? ` (${response.error_msg})` : ''}`);
  }
}

try {
  if (command.data === 'enable') await enable();
  else if (command.data === 'disable') await disable();
  else await status();
} finally {
  await sql.end();
}
