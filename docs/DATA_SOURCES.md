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

Nothing in this table is implemented yet. A row moves to its own section below when its module lands, with the exact endpoint, request pacing, User-Agent and attribution text.

## Policies that apply to every source

- Identifying User-Agent: `sources.userAgent` plus the contact address from `CONTACT_EMAIL`.
- A failed or unparseable fetch keeps the last good data and records `last_error` in `source_snapshots`. Data is never wiped because a source is down.
- Syncs are diff-based: unchanged rows are skipped by checksum.
- Every source and asset is credited on `/attribution`.

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
