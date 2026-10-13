# @commitmates/sources

One module per live data source (Hipo, Linguist, github/explore, registries, gitleaks, Nominatim), each synced into Postgres.

## Public API

One module per source: `fetchRaw`, `normalize`, `sync`.

## Import boundaries

- May import: `db`, `env`, `github`
- Must not import: `core`, `jobs`

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
