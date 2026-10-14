# Data sources

Every external source the app reads: endpoint, policy, refresh cadence, license and attribution. The specification is CLAUDE.md §6; this file records what is actually implemented. Update it in the same commit as the code it describes.

No list of universities, skills, topics, languages or secret patterns is written by hand (CLAUDE.md §2.3). Each comes from a source below and is synced into Postgres.

## Status

| Source | Used for | Module | Refresh | License / terms | Implemented in |
| --- | --- | --- | --- | --- | --- |
| GitHub REST and GraphQL | Users, repos, activity, search | `packages/github` | On demand, ETag-cached | GitHub Terms of Service; rate limits read from response headers | P1-T04 |
| GitHub Linguist | Language colors, extensions, vendored and documentation paths | `packages/sources/linguist` | Weekly | MIT | P1-T09 |
| `github/explore` | Topic aliases and related topics | `packages/sources/explore` | Weekly | CC BY 4.0 | P2-T01 |
| Package registries (npm, PyPI, crates.io, pub.dev, Packagist) | Package keywords and classifiers | `packages/sources/registries` | On demand, TTL `cache.packageMetaTtlDays` | Recorded per registry when implemented | P2-T03 |
| Nominatim (OpenStreetMap) | Free-text location → coordinates | `packages/sources/geocoder` | On demand, cached forever | ODbL data; Nominatim usage policy | P2-T05 |
| Coordinates → timezone (offline library) | IANA timezone lookup | `packages/sources/timezone` | Bundled | Recorded in the ADR that picks the library | P2-T05 |
| gitleaks default rules | Secret detection patterns | `packages/sources/gitleaks` | Weekly | MIT | P2-T10 |
| Stopword dataset | YAKE keyword extraction | `packages/sources` | Snapshot | Recorded in the ADR that picks the dataset | P2-T17 |
| Hipo university-domains-list | Universities and email domains | `packages/sources/hipo` | Weekly | MIT | P3-T01 |
| Disposable email domains | Rejecting throwaway addresses | `packages/sources/disposable-emails` | Weekly | Recorded in the ADR that picks the list | P3-T01 |

Implemented so far: GitHub REST and GraphQL, GitHub Linguist, github/explore, package registries (below). A row moves to its own section below when its module lands, with the exact endpoint, request pacing, User-Agent and attribution text.

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

## GitHub Linguist

- Endpoint: `GET /repos/github-linguist/linguist/contents/lib/linguist/{languages,vendor,documentation}.yml` through the GitHub client, with the raw media type. Three calls per sync, ETag-cached.
- Auth: the `server` identity.
- Fields used: per language `color`, `extensions`, `aliases`; every pattern in `vendor.yml` and `documentation.yml`.
- Regexes: the patterns are Ruby regexes. They are compiled with re2js (RE2, linear time). A pattern RE2 cannot express is stored with `compiled_ok = false`, ignored by the matcher, and counted in `source_snapshots.skipped_count`.
- Not mirrored: Linguist's generated-file detection lives in its Ruby code, not in data files. Only the path-pattern rules are mirrored; generated files are recognized through `.gitattributes` (`linguist-generated`) in the Fairness Report.
- Stored in: `languages`, `path_patterns`.
- Refresh: weekly, Sundays 04:00 UTC (job `sync_linguist`); diff-based. A failed or unparseable fetch keeps the existing rows and records `last_error`.
- License and attribution: MIT, © GitHub, Inc.; credited on `/attribution`.

## github/explore

- Endpoint: `GET /repos/github/explore` (default branch), `GET /repos/github/explore/git/trees/{branch}?recursive=1` (one listing), then `GET /repos/github/explore/git/blobs/{sha}` with the raw media type for each `topics/<slug>/index.md` whose blob sha differs from `topics.blob_sha`.
- Auth: the `server` identity.
- Pacing and limits: at most `sources.explore.batchSize` files per run and never past the job deadline; the job continues in a follow-up run until nothing remains. The first sync reads about 1,300 small files; a normal week reads a handful. An exhausted GitHub budget makes the job wait; it is not recorded as a source failure.
- Fields used: `topic`, `display_name`, `aliases`, `related` from the YAML front matter. `aliases` and `related` are comma-separated strings upstream; entries that are not valid topic slugs are dropped.
- Stored in: `topics` (with the blob sha of the source file).
- Refresh: weekly, Sundays 04:30 UTC (job `sync_explore`). Topics removed upstream are deleted, but never from a truncated listing.
- License and attribution: CC BY 4.0, © GitHub, Inc.; credited on `/attribution`.

## Dependency manifests

Not an external source, but the reading side of §6.6: `packages/sources/src/manifests/parsers.ts` turns a manifest file's text into direct dependencies. Pure, never throws, and keeps at most 500 dependencies per file.

| File | Ecosystem | What is read | Development-only when |
| --- | --- | --- | --- |
| `package.json` | npm | `dependencies`, `peerDependencies`, `optionalDependencies`, `devDependencies` | In `devDependencies` only |
| `requirements*.txt` | PyPI | One PEP 508 requirement per line; options, URLs and editable installs are skipped | The file name says dev, test, docs, lint or ci |
| `pyproject.toml` | PyPI | `[project]`, optional dependencies, PEP 735 groups, Poetry tables | Group is named dev, test, docs, lint, typing, ci or build; any Poetry group |
| `Pipfile` | PyPI | `[packages]`, `[dev-packages]` | In `[dev-packages]` |
| `setup.cfg` | PyPI | `install_requires`, `tests_require`, `[options.extras_require]` | Extras and `tests_require` |
| `pubspec.yaml` | pub.dev | `dependencies`, `dev_dependencies`; SDK dependencies are skipped | In `dev_dependencies` |
| `Cargo.toml` | crates.io | `dependencies`, `build-dependencies`, `dev-dependencies`, workspace and target tables; renamed crates use `package` | In `dev-dependencies` |
| `go.mod` | Go | `require` lines and blocks; `// indirect` is skipped | Never |
| `composer.json` | Packagist | `require`, `require-dev`; `php`, `ext-*`, `lib-*` are skipped | In `require-dev` |
| `Gemfile` | RubyGems | `gem` lines, with block and inline groups | Group is development, test, doc, lint or ci |
| `pom.xml` | Maven | `<dependency>` as `group:artifact`; plugin dependencies and property coordinates are skipped | `scope` is `test` |
| `build.gradle(.kts)` | Maven | String and map coordinates of dependency configurations; version-catalog aliases cannot be resolved | Configuration starts with test, androidTest or debug |

PyPI names are normalized per PEP 503. Fixtures are real manifests from well-known public repositories (`packages/sources/src/__fixtures__/manifests/README.md`).

## Package registries

- Endpoints (one GET per package, JSON):
  - npm: `https://registry.npmjs.org/<name>/latest` (the `latest` document has the same `keywords` and `repository` as the full packument, at a fraction of its size)
  - PyPI: `https://pypi.org/pypi/<name>/json`
  - crates.io: `https://crates.io/api/v1/crates/<name>`
  - pub.dev: `https://pub.dev/api/packages/<name>`
  - Packagist: `https://repo.packagist.org/p2/<vendor>/<name>.json`
  - Go, Maven and RubyGems: no registry call.
- Fallback for every ecosystem: the topics of the package's GitHub repository (from registry metadata, or from a `github.com/…` Go module path), read through the GitHub client.
- Auth: none. Identifying `User-Agent`: `sources.userAgent` plus `CONTACT_EMAIL` (crates.io requires one).
- Pacing and limits: one request in flight per registry and at least `sources.registry.minIntervalMs` between calls, enforced app-wide by locking the registry's row in `registry_pacing`. A failed call still counts. `sources.requestTimeoutMs` per request.
- Fields used: keywords, `Topic ::` classifiers (leaf only), crates.io categories (leaf only), repository URL.
- Derived tags: lowercase, separators become hyphens, then mapped through topic aliases from github/explore so `reactjs` and `react` are one tag. No vocabulary is hand-written.
- Stored in: `package_meta`. A package the registry does not know is stored empty so it is not requested on every run.
- Refresh: on demand (job `enrich_packages`, one per package and month), TTL `cache.packageMetaTtlDays`.
- License and attribution: metadata is published by each registry for programmatic use under its terms; registries are credited on `/attribution`.

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
