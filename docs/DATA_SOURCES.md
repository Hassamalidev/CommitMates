# Data sources

Every external source the app reads: endpoint, policy, refresh cadence, license and attribution. The specification is CLAUDE.md §6; this file records what is actually implemented. Update it in the same commit as the code it describes.

No list of universities, skills, topics, languages or secret patterns is written by hand (CLAUDE.md §2.3). Each comes from a source below and is synced into Postgres.

## Status

| Source | Used for | Module | Refresh | License / terms | Implemented in |
| --- | --- | --- | --- | --- | --- |
| GitHub REST and GraphQL | Users, repos, activity, search | `packages/github` | On demand, ETag-cached | GitHub Terms of Service; rate limits read from response headers | P1-T04 |
| GitHub Linguist | Language colors, extensions, vendored and documentation paths | `packages/sources/linguist` | Weekly | MIT | P1-T09 |
| `github/explore` | Topic aliases and related topics | `packages/sources/explore` | Weekly | Recorded when implemented | P2-T01 |
| Package registries (npm, PyPI, crates.io, pub.dev, Packagist) | Package keywords and classifiers | `packages/sources/registries` | On demand, TTL `cache.packageMetaTtlDays` | Recorded per registry when implemented | P2-T03 |
| Nominatim (OpenStreetMap) | Free-text location → coordinates | `packages/sources/geocoder` | On demand, cached forever | ODbL data; Nominatim usage policy | P2-T05 |
| Coordinates → timezone (offline library) | IANA timezone lookup | `packages/sources/timezone` | Bundled | Recorded in the ADR that picks the library | P2-T05 |
| gitleaks default rules | Secret detection patterns | `packages/sources/gitleaks` | Weekly | MIT | P2-T10 |
| Stopword dataset | YAKE keyword extraction | `packages/sources` | Snapshot | Recorded in the ADR that picks the dataset | P2-T17 |
| Hipo university-domains-list | Universities and email domains | `packages/sources/hipo` | Weekly | MIT | P3-T01 |
| Disposable email domains | Rejecting throwaway addresses | `packages/sources/disposable-emails` | Weekly | Recorded in the ADR that picks the list | P3-T01 |

Implemented so far: GitHub REST and GraphQL (below). A row moves to its own section below when its module lands, with the exact endpoint, request pacing, User-Agent and attribution text.

## Policies that apply to every source

- Identifying User-Agent: `sources.userAgent` plus the contact address from `CONTACT_EMAIL`.
- A failed or unparseable fetch keeps the last good data and records `last_error` in `source_snapshots`. Data is never wiped because a source is down.
- Syncs are diff-based: unchanged rows are skipped by checksum.
- Every source and asset is credited on `/attribution`.

## GitHub REST and GraphQL

- Endpoint: `https://api.github.com` (REST) and `POST /graphql`, through `packages/github` (`githubFor(identity)`).
- Auth: two identities only. `server` uses `GITHUB_SERVER_TOKEN` (fine-grained, public read-only) for anonymous tools and syncs. `user` uses the member's own OAuth token (scopes `read:user`, `user:email`), decrypted per call, for their own analyses.
- Pacing and limits: read from `x-ratelimit-*` headers on every response, from `GET /rate_limit` before an identity's first call, and from GraphQL `rateLimit`. Stored in `github_budgets`. Calls stop when `remaining - cost` would go below `github.reserve.core`, `github.reserve.graphql` or `github.reserve.search`. Search calls are spaced by `ceil(60000 / limit)` ms plus up to 250 ms of jitter under a row lock. A 403 or 429 with `retry-after` waits that long; without it, the wait starts at 60 s and doubles.
- Conditional requests: every REST GET sends `If-None-Match` and `If-Modified-Since` from `api_cache`; a 304 returns the cached body. The cache key includes the identity because ETags are tied to the token.
- Timeouts: `github.requestTimeoutMs` per request. Pagination is capped by `github.maxPages.default`.
- `/stats/*`: 202 answers are retried up to `fairness.statsRetryMax` times inside the deadline, then reported as pending so the job waits.
- User input: only links parsed by `parseGitHubUrl` into owner, repo and number are ever requested.
- Stored in: `api_cache`, `github_budgets`; feature tables arrive with their features.
- License and attribution: GitHub Terms of Service; credited on `/attribution`.
- Known behaviors: public events cover about 90 days and at most 300 events; search returns at most 1,000 results per query.

## How to add a section

```markdown
## <Source>

- Endpoint: …
- Auth: …
- Pacing and limits: … (settings keys)
- Fields used: …
- Stored in: `<table>`
- Refresh: … (job `<type>`)
- License and attribution: …
- Known behaviors: …
```
