# @commitmates/worker

Runs the job runner in a loop for local development and self-hosting. In staging and production, pg_cron calls `/api/jobs/tick` instead (CLAUDE.md §5.4).

## Public API

None. `src/index.ts` is the process entry point; `src/loop.ts` holds the reusable loop.

## Import boundaries

- May import: `jobs`, `core`, `env`
- Must not import: `ui`
