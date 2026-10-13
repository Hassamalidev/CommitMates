# @commitmates/core

Domain services and job handlers: one folder per feature, combining data, algorithms and storage.

## Public API

Domain services and job handlers.

## Import boundaries

- May import: `algorithms`, `db`, `env`, `github`, `sources`, `jobs`, `email`
- Must not import: `apps/*`, `ui`

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
