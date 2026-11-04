# ADR-014: Faster day-one tools

Date: 2026-11-04 · Status: accepted

## Context

Running the app locally, the Compatibility Check, Recruiter-Ready Score, Group Fairness Report, Gap Finder, Project Graveyard and Open-Source Starter often took minutes, and two of them sometimes never finished. Timing each tool through its API from cold caches (POST, then the job's event stream) showed five causes:

1. **One request at a time.** Every job read GitHub strictly in sequence. GitHub takes 0.7–1.4 s per call from this machine, and Gap Finder, Graveyard and the OSS Starter make 100–700 calls.
2. **A fixed gap between searches.** The search pacer spaced every search by `ceil(60000 / limit)` ms (2 s at 30 per minute), even when the allowance had room. A taxonomy expansion could also look up the GitHub-wide count of every topic it saw, one search each.
3. **Continuations waited for the next tick.** A job that returned `continue` was picked up by the next cron tick (every minute in production) or worker loop, while the visitor watched.
4. **Profiles of large accounts failed.** One GraphQL query read the account, its contribution calendar and its first 100 repositories with languages and topics. For accounts like `kentcdodds` or `addyosmani` it ran past GitHub's time limit (about 10 s) and GitHub answered 502 every time, so Compatibility and Recruiter jobs retried until they were dead.
5. **Background work took the search allowance.** The country crawler runs every five minutes on the server token and could use every search left in the minute.

## Decision

- **Bounded parallel reads.** `mapConcurrent` and `batches` (packages/github) run at most `github.concurrency` (6) requests per job at once, with the deadline checked between batches. The work runs in batches in profile manifests and events, taxonomy manifests, fairness statistics, commit lists, trees and per-commit files, Gap Finder peers, Graveyard signals and stars, OSS projects, and the two sides of a Compatibility Check. GitHub allows 100 concurrent requests per token.
- **A REST rate cap per token.** Every REST call takes a token from a Postgres bucket (`take_token`) of `github.requestsPerMinute` (800) per identity. That keeps parallel jobs below GitHub's secondary limit of 900 points per minute. A call waits for a token, or returns `wait` to the job when the wait would pass its deadline.
- **Allowance-based search pacing.** The search pacer reserves one call of the reported allowance under the row lock. It waits for the reset only when fewer than `github.reserve.search` would remain. Searches within the allowance run back to back. This replaces the fixed gap in CLAUDE.md §5.6: limits are still read from GitHub and never assumed, and the reserve still holds.
- **Background searches leave room for visitors.** The country crawler and the weekly contribution refresh share the server token. They could spend a minute's whole search allowance, and the Open-Source Starter then waited twice for the window to reset. Their searches pass `background: true` and stop while fewer than `github.reserve.searchBackground` (10) remain, which leaves those for the tools people are waiting on.
- **At most `taxonomy.maxCountLookups` (8) topic-count searches per expansion.** The most frequent topics are counted first. A topic without a count is scored with the largest known count, so it ranks as common rather than rare. Counts are cached, so later expansions fill in the rest.
- **The event stream drives interactive continuations.** While a visitor watches, `watchJob` runs the newest link of the chain itself when it is a due INTERACTIVE job, within `jobs.interactiveBudgetMs`. Maintenance and crawl jobs are left to the tick.
- **Graveyard work is cut where the answer is already known.** Global candidates are cached for `cache.searchTtlHours`, so continuations do not search again. A candidate's README and commit estimate are read first, and a candidate that fails the filters gets no other request. A repository GitHub refuses to show (403 or 404) is skipped instead of failing the search (`unlessUnreadable`). The same applies in Gap Finder and the OSS Starter.
- **A follow-up does not search again.** Searches made with `reuse: true` (OSS Starter, Gap Finder, taxonomy samples, the FYP checker) store their answer in `api_cache` for `cache.searchTtlHours`, never past `privacy.nonUserRawTtlHours`. A continuation repeating the same search reads it from there. Repeating searches back to back had tripped GitHub's secondary limit (a 403 without `retry-after`) and cost the OSS Starter a minute of waiting.
- **Profiles in two queries.** The account and its contribution calendar are one query. Repositories are another, read in pages of `github.profilePageSize` (50) and started alongside the first query. A page that GitHub times out on (502 or 504) is read once more at half the size, and the next page continues from where it ended.

## Alternatives considered

- **Higher concurrency.** Rejected: 6 already makes network latency, not concurrency, the limit. More would crowd out other jobs on the same token and approach the secondary limits.
- **Keeping the 2 s search gap.** Rejected: it made every search-heavy tool at least twice as slow as GitHub's own limit requires.
- **Retrying the 100-repository profile query.** Rejected: the 502 is deterministic for large accounts, so retries only delay the failure.
- **Fewer repositories per profile.** Rejected: `github.maxReposPerProfile` is a product setting; paging keeps it.

## Consequences

- Several jobs can now share a token's allowance faster. The bucket, the reserves and the waits keep them inside GitHub's limits, and a job that runs out waits instead of failing.
- A visitor's open event stream does work in the web request. It stays within the interactive budget and the stream's lifetime, and the tick still picks up anything left.
- Times measured here include 0.7–1.4 s of latency per GitHub call from Pakistan. A deployment close to GitHub should be faster.
- Searches stay one at a time per job: GitHub's secondary limit reacts to bursts of searches, so Gap Finder and the Graveyard still spend most of their time waiting on serial searches and reading peers.

## Verification

Measured on 2026-11-04 against live GitHub with the server token, every cache cleared before each tool, and a minute between tools so each starts with a full search allowance. Ranges are separate runs; the first run after a restart includes compiling the route:

| Tool | Input | Before | After |
| --- | --- | --- | --- |
| Compatibility Check | tj, addyosmani | 42 s, or failing with GitHub 502 | 27–43 s |
| Recruiter-Ready Score | kentcdodds | did not finish (GitHub 502) | 23–27 s |
| Group Fairness Report | sindresorhus/is-online | 228 s | 14–21 s |
| Gap Finder | sindresorhus/is-online | 254 s | 64–75 s |
| Project Graveyard | "pomodoro timer" | over 300 s | 96–107 s |
| Open-Source Starter | Go | 275 s | 37 s |

Tests: `mapConcurrent`, `unlessUnreadable`, the search allowance, the background search reserve and the REST bucket (packages/github); a Graveyard search that skips a refused repository; profile pages of `github.profilePageSize` and the half-size retry; the driven continuation and the maintenance jobs it leaves alone (packages/jobs).
