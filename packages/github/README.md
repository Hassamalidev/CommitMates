# @commitmates/github

Budget-aware GitHub REST and GraphQL client with an ETag cache, a search pacer and typed errors.

## Public API

`githubFor(identity)`, typed query functions, error classes, `parseGitHubUrl`.

## Import boundaries

- May import: `db`, `env`
- Must not import: `core`, `jobs`, `sources`

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
