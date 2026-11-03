# ADR-013: Legal pages and a generated attribution page

Date: 2026-11-04 · Status: accepted

## Context

P7-T04 asks for a final privacy policy that matches what the app actually does with data, final terms, and an `/attribution` page generated from the sources and dependency licenses (CLAUDE.md §5.12, §6.11). The first versions from P1-T10 were hand-written and marked as drafts, and their software section promised a package list "before launch".

## Decision

- **Packages from the license report.** `pnpm licenses:report` writes `apps/web/src/generated/dependency-licenses.json` from the same production dependency closure that `check:licenses` evaluates (`pnpm licenses list --prod`, tooling excluded). It holds one entry per package, with the license and homepage, sorted, and without versions. `check:licenses`, part of `pnpm verify` and CI, fails when the file no longer matches the installed dependencies. The page renders it as a captioned table. A licence that requires attribution, such as caniuse-lite's CC-BY-4.0, is credited there by name, license and link.
- **Sources from the code and `source_snapshots`.** `SYNCED_SOURCE_NAMES` in core names every source module. A core test keeps it equal to the modules in `packages/sources`, and the page's copy is typed `Record<SyncedSourceName, Credit>`, so a new source cannot ship without a credit. Each credit shows its last sync date from `source_snapshots`. Sources used per request (the GitHub API, package registries, Nominatim, tz-lookup) are credited in the copy.
- **Policies follow `docs/PRIVACY.md`.** The privacy policy states, in plain words, what each feature stores, who sees what, the university email and code handling, non-members and the country index with its opt-out, the salted daily IP hash, retention, what deletion does, and the services used. The terms add moderation and appeals, the fact that credits have no money value, and how changes are dated. Both drop the draft note and end with the contact address from `CONTACT_EMAIL`.

## Alternatives considered

- **Generating the package list during `next build`.** Rejected: lint and typecheck run before the build in `pnpm verify` and would fail on a fresh clone, and the serverless bundle would need the report traced in separately. A committed file that a check keeps current gives the same guarantee.
- **Keeping versions in the list.** Rejected: every Dependabot patch update would need a regenerated file. Licenses change with packages, not with patch versions.

## Consequences

- Adding or removing a production dependency requires running `pnpm licenses:report` and committing the result. `check:licenses` says so when it fails.
- The legal pages are only as true as `docs/PRIVACY.md`, so the two must change together. PRIVACY.md now says so.
- This is not legal advice. The texts describe the implementation accurately; a person with legal knowledge should read them before a commercial launch.

## Verification

`pnpm check:licenses` (141 production packages); the core attribution tests; e2e: `/attribution` credits all six synced sources, shows a sync state, lists more than 100 packages including `next` (MIT) and `caniuse-lite` (CC-BY-4.0), and the pages pass the accessibility audit (ADR-012). Checked on 2026-11-04.
