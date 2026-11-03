# ADR-011: Performance review before launch

Date: 2026-11-04 · Status: accepted

## Context

P7-T02 checks the budgets of CLAUDE.md §11.6 before launch. This record covers the database (P7-T02a) and the web pages (P7-T02b, added when that part is done).

## Decision

### Database (P7-T02a)

§11.6 asks that no hot-path query scans a table of more than 10,000 rows sequentially, and §7 that every foreign key is indexed. Both are now tests (`packages/db/src/schema/hot-paths.test.ts`): the large tables are filled with synthetic rows (20,000 per table; 200,000 repositories, the default `crawler.maxRepos`), analyzed, and the plan of each hot-path query is read with `EXPLAIN`: claiming jobs and following one, a member's unread notifications, a conversation page, cache lookups and purges, GitHub users and repositories by login and owner, the Graveyard's country search, metric samples, the audit log page and rate buckets.

Findings and fixes (migration `0071_hot_path_indexes.sql`, additive only):

- **Nine foreign keys had no index**: `university_requests.university_id` and `reviewed_by`, `vouches.university_id`, `departments.created_by` and `merged_into_id`, `invites.created_by`, `reports.target_message` and `resolved_by`, `swap_proposals.university_id`. Deleting a member, a message or a university scanned those tables. Each now has an index, and a test lists any foreign key without one.
- **The country search could not use an index.** Its condition was `search_tsv @@ … or coalesce(topics, '{}') && …`; the `coalesce` hid the column and `topics` had no index, so every country search scanned all of `gh_repos`. A GIN index on `gh_repos.topics` was added and the `coalesce` dropped (a null `topics` overlaps nothing either way); the same was done in the university listing search. At 200,000 repositories the plan is now a BitmapOr over both GIN indexes, about 50 ms on this machine, instead of a full scan.
- Everything else already used its index: the job claim uses the partial `jobs_ready_idx`; the audit log pages by primary key.

## Alternatives considered

- **Only checking that an index exists.** Rejected: the country search had a usable full-text index and still scanned, because of how its condition was written. Reading real plans on realistic volumes catches that.
- **Dropping the `OR` by running two queries and merging.** Not needed once both sides are indexable.

## Consequences

- Hot-path plans and foreign-key indexes are checked on every test run; a new query written in a way the planner cannot index fails here.
- The test file takes about 30 seconds, most of it inserting the synthetic rows.

## Verification

Plans read with `EXPLAIN` and `EXPLAIN ANALYZE` on the local Supabase Postgres on 2026-11-04 (synthetic data in a rolled-back transaction, and in the test databases).
