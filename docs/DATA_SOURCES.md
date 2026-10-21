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
| Coordinates → timezone (offline library) | IANA timezone lookup | `packages/sources/geocoder` | Bundled | CC0-1.0 (ADR-004) | P2-T05 |
| gitleaks default rules | Secret detection patterns | `packages/sources/gitleaks` | Weekly | MIT (code and configuration) | P2-T10 |
| Stopword dataset (stopwords-iso) | YAKE and BM25 | `packages/sources/stopwords` | Weekly | MIT (ADR-005) | P2-T17 |
| Hipo university-domains-list | Universities and email domains | `packages/sources/hipo` | Weekly | MIT (ADR-007) | P3-T01 |
| Disposable email domains | Rejecting throwaway addresses | `packages/sources/disposable-emails` | Weekly | CC0-1.0 (ADR-007) | P3-T01 |

Implemented so far: GitHub REST and GraphQL, GitHub Linguist, github/explore, package registries, Nominatim, coordinates → timezone, gitleaks, stopwords-iso, Hipo university-domains-list, disposable email domains (below). A row moves to its own section below when its module lands, with the exact endpoint, request pacing, User-Agent and attribution text.

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
- Shared streaks: each member's contribution calendar (`user.contributionsCollection.contributionCalendar`, GraphQL) over the days being judged, read with that member's own token, so private counts appear only when they enabled them. Only the per-day counts are stored (`pair_days`).
- Discover's cold start: one user search (`GET /search/users`, people only) by the member's top language and their university's country, with the member's own token when it is valid. The logins and avatars are cached in `analysis_cache` (kind `developers_like_you`) for the shorter of `cache.searchTtlHours` and `privacy.nonUserRawTtlHours`, filed under the member's login; nothing else about these people is stored.
- Country crawler (F18): user searches `location:"<seed>" type:user created:<from>..<to>` with the server token through the search pacer, 100 per page, a range split in half while its total is above `crawler.searchCap`; then, per new account, one page of its own repositories (`GET /users/{login}/repos`, metadata only, at most `crawler.reposPerUser`). Seeds are the countries of universities with verified members and members' resolved cities with at least `crawler.minCitySeedMembers` members; ranges start at `crawler.earliestAccountDate`.
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

## Nominatim (OpenStreetMap)

- Endpoint: `GEOCODER_BASE_URL` + `/search?format=jsonv2&addressdetails=1&limit=1&q=<query>`. The endpoint comes from the environment, so it can be switched without a code change.
- Auth: none. `User-Agent: GEOCODER_USER_AGENT` (site URL and contact address).
- Pacing and limits: one request per `geocoder.minIntervalMs` for the whole app. Every call is made while holding the single `geocoder_lock` row `for update`, waits until `last_call_at + geocoder.minIntervalMs`, and writes `last_call_at` afterwards, also when the call failed. Overlapping ticks queue on the row lock. A run makes at most `floor(remaining budget / geocoder.minIntervalMs)` calls and stops after the first failure. `sources.requestTimeoutMs` per request. No autocomplete and no bulk lookups beyond this queue.
- Normalization before lookup: URLs and emoji removed, whitespace collapsed, trimmed, lowercased, cut at 120 characters. The result is the cache key.
- Never sent: empty strings, strings without a letter, and exact matches of `geocoder.nonPlaceTerms`. They are stored as `unresolvable` without a call.
- Fields used: `lat`, `lon`, `importance` (stored as `confidence`), `address.country_code`, and the first of `address.city`, `town`, `village`, `municipality`, `county`, `state` as the city.
- Stored in: `geocode_cache` (`pending` → `resolved` or `unresolvable`), kept forever. `gh_users.geocode_key` points at the row.
- Refresh: never; a string is looked up once. Job `geocode_pending`, scheduled every minute. A failed lookup stays `pending` and moves to the back of the queue.
- License and attribution: data © OpenStreetMap contributors, ODbL 1.0. "© OpenStreetMap contributors" is shown wherever a geocoded result is displayed and on `/attribution`.
- Known behaviors: a location with no match returns an empty array and is stored as `unresolvable`.

## Coordinates → timezone

- Library: `@photostructure/tz-lookup` (CC0-1.0), an offline lookup table. No network call.
- Used for: the IANA timezone of a resolved location, stored on its `geocode_cache` row.
- Known behaviors: the table is approximate near borders and at sea; coordinates outside the valid range give no timezone. The timezone database inside the package is as new as the installed version (decision in ADR-004).
- License and attribution: the library is CC0-1.0; its table is derived from timezone-boundary-builder, which is built from OpenStreetMap data (ODbL 1.0). Both are credited on `/attribution`.

## gitleaks default rules

- Endpoint: `GET /repos/gitleaks/gitleaks/contents/config/gitleaks.toml` (raw media type, conditional request through the GitHub client, default branch).
- Auth and pacing: the server identity; GitHub's budgets apply (CLAUDE.md §5.6).
- Parsed with `smol-toml`: every `[[rules]]` entry (`id`, `description`, `regex`, `path`, `keywords`, `entropy`, `secretGroup`, `[[rules.allowlists]]` with `condition`, `regexTarget`, `regexes`, `paths`, `stopwords`) and the global `[allowlist]` / `[[allowlists]]`.
- Compiled with RE2 (`re2js`): a rule whose own pattern RE2 cannot express is stored with `compiled_ok = false` and skipped by the scanner; allowlist patterns RE2 cannot express are dropped one by one. The count of unusable rules is recorded in `source_snapshots.skipped_count`.
- Stored in: `secret_rules` (diff by per-rule checksum), `secret_global_allowlist` (one row).
- Refresh: weekly (job `sync_gitleaks`, Sunday 04:45 UTC).
- Scan order as implemented in `packages/core/src/secrets/scan.ts`: global path allowlist → the rule's path condition → case-insensitive keyword prefilter → regex over the whole file → entropy of the secret (the rule's `secretGroup`, else the first non-empty group, else the whole match) → the rule's allowlists → the global regexes and stopwords. A rule with only a path reports the file at line 1.
- License and attribution: MIT; credited on `/attribution`.

## stopwords-iso

- Endpoint: `GET /repos/stopwords-iso/stopwords-iso/contents/stopwords-iso.json` (raw media type, conditional request, default branch).
- Fields used: the word list of every language with a two-letter ISO 639-1 code; words are trimmed, lowercased, deduplicated and sorted.
- Stored in: `stopwords` (one row per language, diffed by checksum). Callers fall back to English for a language without a list.
- Refresh: weekly (job `sync_stopwords`, Sunday 05:00 UTC).
- License and attribution: MIT, © 2020 Gene Diaz; credited on `/attribution`.

## Hipo university-domains-list

- Endpoint: `GET /repos/Hipo/university-domains-list/contents/world_universities_and_domains.json` (raw media type, conditional request, default branch `master`).
- Fields used: `name`, `domains`, `web_pages`, `country`, `alpha_two_code`, `state-province`. Entries without domains or with a code that is not two letters are skipped; repeated entries (same country code and name) are merged.
- Normalization: domains lowercased, trimmed and deduplicated; `slug = kebab(name) + "-" + code`, with `-2`, `-3` on collision (a name with no Latin letters uses its first domain); checksum per university.
- Stored in: `universities` (`source = 'hipo'`, `source_key = CODE:lowercased name`) and `university_domains`. Diff upsert by checksum. A university the list drops is deleted when it has no members, otherwise marked `source_missing`.
- Matching: `matchEmailToUniversity` walks the email domain's label-boundary suffixes, longest first (`domainSuffixes` in `packages/algorithms`). The longest registered suffix wins, and several universities are returned when they share that domain.
- Refresh: weekly (job `sync_hipo`, Sunday 06:00 UTC).
- License and attribution: MIT; credited on `/attribution`.

## Disposable email domains

- Endpoint: `GET /repos/disposable-email-domains/disposable-email-domains/contents/disposable_email_blocklist.conf` (raw media type, conditional request, default branch `main`).
- Format: one domain per line; blank lines and `#` comments skipped; lowercased and deduplicated.
- Stored in: `disposable_domains` (set difference: new domains inserted, dropped ones deleted).
- Use: an email is rejected when its domain or any parent domain is listed.
- Refresh: weekly (job `sync_disposable_emails`, Sunday 06:30 UTC).
- License and attribution: CC0 1.0 (ADR-007); credited on `/attribution` as a courtesy.

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
