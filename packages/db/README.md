# @commitmates/db

Postgres access: Drizzle schema, migrations, typed query modules, the Settings Engine and token encryption.

## Public API

`db`, schema, query modules, `getSetting`, `setComputed`, `setOverride`, crypto helpers.

## Import boundaries

- May import: `env`
- Must not import: `core`, `jobs`, `github`, `sources`

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
