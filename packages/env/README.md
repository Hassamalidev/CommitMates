# @commitmates/env

Validates environment variables with zod at startup and fails fast with a clear list of what is missing.

## Public API

`serverEnv`, `clientEnv`, `workerEnv`.

## Import boundaries

- May import: zod
- Must not import: other internal packages

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
