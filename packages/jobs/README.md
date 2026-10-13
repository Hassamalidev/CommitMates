# @commitmates/jobs

Postgres-backed job queue: enqueue with idempotency, claim with `FOR UPDATE SKIP LOCKED`, the tick runner and schedules.

## Public API

`enqueue`, `runTick`, `registerHandler`, `PRIORITY`.

## Import boundaries

- May import: `db`, `env`
- Must not import: `core`

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
