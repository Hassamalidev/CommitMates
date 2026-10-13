# @commitmates/algorithms

Pure, deterministic formulas: statistics, similarity, information retrieval, clustering, graphs and scoring.

## Public API

Pure functions and their types. No I/O, no clock, no unseeded randomness; settings values arrive as arguments.

## Import boundaries

- May import: nothing internal
- Must not import: anything with I/O

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
