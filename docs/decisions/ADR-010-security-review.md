# ADR-010: Security review before launch

Date: 2026-11-04 · Status: accepted

## Context

P7-T01 walks the threat model of CLAUDE.md §5.10 before launch: content security policy, row level security on every table, input validation on every action and route, and the dependency tree. This record lists what was checked, what was found and what was done. It grows with each part of the review (P7-T01a dependencies, P7-T01b headers, RLS and token rotation, P7-T01c input validation and the threat model walk).

## Decision

### Dependencies (P7-T01a)

`pnpm audit --prod` on 2026-11-04 reported 18 advisories (2 critical, 6 high, 10 moderate) in five packages:

| Package | Where | Advisories | Action |
| --- | --- | --- | --- |
| `next` 16.4.0 | `apps/web` | 2 critical, 1 high, fixed in 16.4.1 | Upgraded to 16.4.3 (released 2026-10-23, MIT) |
| `re2js` 2.8.6 | `packages/sources` (Linguist and gitleaks patterns) | 1 high, fixed in 2.8.7 | Upgraded to 2.9.1 (MIT) |
| `nodemailer` 10.0.12 | `packages/email` | 5 moderate, fixed in 10.1.4 | Upgraded to 10.2.0 (MIT-0; the license exception of ADR-009 still applies) |
| `undici` 8.x | test environment only (`vitest` → `jsdom`) | 4 high, 4 moderate, fixed in 8.12.2 | `pnpm-workspace.yaml` override to `^8.12.3` until jsdom requires it |
| `minimatch` 10.2.6 | lint toolchain only (`typescript-eslint`, `eslint-plugin-import-x`) | 1 moderate (denial of service through pattern amplification), fixed in 11.0.1 | Not upgraded; see below |

The release-age rule of the workspace (versions old enough to have been reviewed) was kept: every chosen version was at least several days old.

**minimatch is accepted, not fixed.** The only fixed line, 11.x, is licensed BlueOak-1.0.0, which is outside the license allow-list of CLAUDE.md §2.2, and its dependents pin 10.x. The vulnerable code runs only in ESLint on this repository's own glob patterns, never on user input and never in shipped code. Dependabot will offer the fix once the toolchain moves; until then the risk is a slow lint run on a crafted pattern committed to this repository, which review would catch.

The Next.js build had already been printing an upgrade advisory for 16.4.0 (noted in the P6-T07a changelog line); it no longer does.

## Alternatives considered

- **Overriding minimatch to 11.x.** Rejected: it brings a license outside §2.2 into the tree, and the advisory does not reach shipped code.
- **Staying on 16.4.0 until a minor release.** Rejected: the advisories are critical and in the web framework itself.

## Consequences

- `pnpm audit --prod` reports one moderate advisory (minimatch, lint only) instead of 18.
- Upgrades go through the usual gates: `pnpm verify` and the e2e suite pass on the new versions.

## Verification

Advisories read from `pnpm audit --prod --json` (npm bulk advisory endpoint) on 2026-11-04. Versions and release dates from `npm view <package> time` on 2026-11-04; licenses from `npm view <package>@<version> license`: next 16.4.3 MIT, re2js 2.9.1 MIT, nodemailer 10.2.0 MIT-0, minimatch 11.0.3 BlueOak-1.0.0.
