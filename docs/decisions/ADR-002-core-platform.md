# ADR-002: Core platform implementation choices

Date: 2026-10-14 · Status: accepted

## Context

Phase 1 builds the database layer, the Settings Engine, the job system and the GitHub client. A few points in CLAUDE.md could not be implemented exactly as written. This record lists each one, what was done, and why.

## Decision

### Dependencies added

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| drizzle-orm | 0.45 | Apache-2.0 | Typed SQL and schema |
| drizzle-kit | 0.31 | MIT | Migration generation (dev) |
| postgres (postgres.js) | 3.4 | Unlicense | Driver, `prepare: false` for the transaction pooler |
| pino | 10.4 | MIT | JSON logs with redaction |
| cron-parser | 5.10 | MIT | Next run time of `job_schedules` |
| `@octokit/core`, `@octokit/request-error` | 7 | MIT | GitHub REST and GraphQL transport |
| msw | 2.15 | MIT | HTTP mocking in tests |

### Octokit without the throttling and retry plugins

§3.1 lists the throttling and retry plugins. Both keep their state in process memory (Bottleneck queues), and they wait and retry inline. Our runtime is many short-lived serverless invocations plus a worker, so limits must be coordinated in Postgres, and a blocked call must hand control back to the job runner as `wait` instead of sleeping.

The client therefore uses `@octokit/core` for transport only and implements the behavior §5.6 specifies itself:

- budgets in `github_budgets`, read from response headers and `/rate_limit`;
- reserve checks that throw `RateLimitError(resetAt)`;
- a search pacer that locks the identity's `search` row;
- `retry-after` and exponential backoff from 60 seconds for secondary limits;
- 5xx and network errors become `GitHubServerError`, which the job runner retries with backoff.

### MSW 2, not 3

MSW 3 intercepts at the socket level. In tests that also talk to Postgres it corrupted the database protocol ("expected SASL response"). MSW 2 intercepts `fetch` and `http.ClientRequest` only, which is all the code under test uses. Revisit when MSW 3 can leave non-HTTP sockets alone.

### One scratch database per test file

§11.3 says each integration test file creates a fresh schema. Drizzle's migrations create enum types in `public`, so they cannot be replayed into another schema. `@commitmates/db/testing` instead clones a database per test file from a template that has every migration applied. The template is rebuilt when the migrations change.

A fresh database has no Supabase `auth` schema, so the template gets a minimal stand-in: the `anon`, `authenticated` and `service_role` roles, Supabase's default grants on `public` (so RLS, not a missing grant, is what the tests prove), `auth.users`, and `auth.uid()` reading `request.jwt.claim.sub`. CI also applies the migrations to the real local Supabase database.

### Shared server utilities live in `packages/db`

§4.3 lets every server package import `db` and nothing else in common. The `AppError` hierarchy (§10.4), the pino logger (§5.13) and token encryption (§5.10) are needed by `github`, `sources`, `jobs` and `core`, so they live in `packages/db` and are exported from it.

### `JobContext` has no `github` factory

§5.4 puts `github: (identity) => GitHubClient` on `JobContext`. `packages/jobs` may not import `packages/github` (§4.3). Handlers live in `core`, which may import both, and call `githubFor(identity)` directly. The client is budget-aware on its own, so nothing is lost.

### Search results are not ETag-cached

Search responses are paced and budgeted but not stored in `api_cache`: the results feed `analysis_cache` with their own TTLs (§5.8), and caching raw search pages would duplicate that.

## Alternatives considered

- **Use the Octokit plugins with their handlers disabled.** Rejected: they would be dead weight that still installs Bottleneck timers.
- **Relax the boundary table so `jobs` can import `github`.** Rejected: §4.3 is enforced by lint and the direct call works.
- **Run integration tests in the Supabase `postgres` database with a schema per file.** Rejected: needs every migration rewritten to be schema-relative.

## Consequences

- Rate-limit behavior is fully under test (MSW covers 200, 304, 202, 401, 403 and 429 with and without `retry-after`, 404, 422, 5xx).
- Integration tests need a reachable Postgres on port 54322 (`pnpm db:start`); CI starts the local Supabase stack.
- The spec deviations above are also logged in the CLAUDE.md changelog.

## Verification

Licenses read from the npm registry on 2026-10-14 and enforced by `pnpm check:licenses`. GitHub's rate-limit headers and `/rate_limit` behavior are exercised against recorded response shapes in `packages/github/src/client.test.ts`; they are read at runtime and never assumed.
