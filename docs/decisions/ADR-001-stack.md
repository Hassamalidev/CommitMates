# ADR-001: Technology stack and version pins

Date: 2026-10-14 · Status: accepted

## Context

CLAUDE.md §3 fixes the stack: one language (TypeScript), one database (Postgres on Supabase), one web deploy (Next.js on Vercel), no paid services, and only permissive licenses (§2.2). The version policy asks for the latest stable release of each package at P0, with major versions recorded here.

Three packages could not be taken at their latest major, and one optional dependency had to be removed.

## Decision

### Versions installed in Phase 0

| Tool | Version | License | Note |
| --- | --- | --- | --- |
| Node.js | 24 (LTS) | MIT | `.nvmrc` |
| pnpm | 12.8.1 | MIT | `packageManager` field; workspace catalog keeps shared versions aligned |
| Turborepo | 2.11.7 | MIT | See "turbo pin" below |
| TypeScript | 6.0.x | Apache-2.0 | See "TypeScript 6" below |
| Next.js | 16.4 | MIT | App Router |
| React, React DOM | 19.3 | MIT | |
| Tailwind CSS, `@tailwindcss/postcss` | 4.3 | MIT | |
| zod | 4.6 | MIT | |
| ESLint, `@eslint/js` | 9.39 | MIT | See "ESLint 9" below |
| typescript-eslint | 8.71 | MIT | |
| eslint-plugin-import-x | 4.17 | MIT | Maintained fork of eslint-plugin-import with flat-config support; provides `no-restricted-paths` |
| eslint-import-resolver-typescript | 4.4 | ISC | |
| eslint-plugin-react | 7.37 | MIT | |
| eslint-plugin-react-hooks | 7.1 | MIT | |
| eslint-plugin-jsx-a11y | 6.10 | MIT | |
| eslint-config-prettier | 10.1 | MIT | |
| Prettier | 3.9 | MIT | |
| Vitest, `@vitest/coverage-v8` | 5.0 | MIT | |
| Testing Library (react, jest-dom, user-event) | 16.3, 7.0, 14.6 | MIT | |
| jsdom | 30.1 | MIT | |
| MSW | 3.0 | MIT | |
| axe-core | 4.11 | MPL-2.0 | Unmodified, test-time only |
| Playwright | 1.64 | Apache-2.0 | |
| `@axe-core/playwright` | 4.13 | MPL-2.0 | Unmodified, test-time only |
| tsx | 4.23 | MIT | Runs the worker and scripts |
| Supabase CLI | 2.120 | MIT | Local stack only |

Exact versions are in `pnpm-lock.yaml`. Later additions get their own ADR or a line in the ADR of the task that adds them.

### TypeScript 6, not 7

TypeScript 7.0 is the latest release, but typescript-eslint 8 declares `typescript >=4.8.4 <6.1.0`. The type-aware lint rules that §10.12 requires (`no-floating-promises` and others) depend on it, so the workspace pins `typescript ~6.0.3`. Move to 7 in a `chore(deps)` commit once typescript-eslint supports it.

### ESLint 9, not 10

`eslint-plugin-react` and `eslint-plugin-jsx-a11y` declare ESLint peers up to 9. §10.12 requires `jsx-a11y/recommended`, so the workspace pins `eslint ^9.39`. Move to 10 when both plugins support it.

### turbo pin

pnpm 12 refuses packages published inside its minimum release age window. turbo 2.11.8 was published on 2026-10-13, one day before this install, so the workspace pins 2.11.7 rather than exempting turbo from the policy. Dependabot will raise the pin.

turbo also writes an `AGENTS.md` file when it detects a coding agent. That file is outside the repository layout in §4.1, so `agentGuidance` is `false` in `turbo.json`.

### sharp removed

Next.js lists `sharp` as an optional dependency for image optimization. sharp's prebuilt binaries bundle libvips, which is LGPL-3.0-or-later and outside the allow-list in §2.2. `pnpm-workspace.yaml` therefore ignores it and `next.config.ts` sets `images.unoptimized`. The only remote images are GitHub avatars, which are requested at their display size.

### Packages are consumed as TypeScript source

Internal packages export `./src/index.ts` directly. Next.js compiles them through `transpilePackages`, Vitest and tsx read them as-is. There is no per-package build step, so `pnpm build` builds only the web app.

### `server-only` is used in the web app only

§4.3 asks server-only modules to start with `import "server-only"`. That import throws outside a React Server Components bundler, and the worker and the tests run the same packages in plain Node. The marker is therefore applied in `apps/web/src/server`, and package boundaries (`ui` may import no server package) are enforced by ESLint.

## Alternatives considered

- **Exempt turbo 2.11.8 from the release-age policy.** Rejected: the policy exists to keep freshly published packages out, and one patch version is not worth an exemption.
- **Keep sharp and record an LGPL exception.** Rejected: §2.2 has no LGPL entry, and the app does not need server-side image optimization.
- **ESLint 10 without the React and accessibility plugins.** Rejected: §10.12 requires them.

## Consequences

- Two majors behind on TypeScript and one on ESLint until the lint ecosystem catches up.
- Images are not resized by the server. Any future image source other than GitHub avatars needs a size-aware URL or a new decision.
- `pnpm check:licenses` checks the production dependency closure of every app and package except `packages/config`, whose dependencies are linters and test libraries.

## Verification

Licenses were read from the npm registry (`pnpm view <package> license`) on 2026-10-14 and are enforced by `pnpm check:licenses` on every run.

Free-tier terms read on 2026-10-14:

- **Supabase Free** — <https://supabase.com/pricing>: 500 MB database per project, 50,000 monthly active users, 2 active projects, projects paused after 1 week of inactivity, Realtime 200 concurrent connections and 2 million messages per month, 5 GB egress, 1 GB file storage. The design uses two projects (staging and prod), which is exactly the limit. `storage.dbBudgetMb` defaults to 450, below the 500 MB cap.
- **Vercel Hobby** — <https://vercel.com/docs/limits> (page last updated 2026-09-16): function maximum duration 300 s (default and max), 100 deployments per day, build step at most 45 minutes. `jobs.tickBudgetMs` (45,000) and `jobs.interactiveBudgetMs` (25,000) are far below the 300 s limit.

Not re-read today; verify before relying on them:

- **Vercel Hobby non-commercial clause** (CLAUDE.md §3.2). Confirm in Vercel's fair use guidelines before launch (P7-T06).
- **GitHub Actions** minutes for public repositories. CI runs only lint, typecheck, tests, build and scans (§3.1).
- **Transactional email provider.** Chosen in P3-T02 with its own ADR; `email.maxPerDay` is set from its quota then.
- **Sentry free plan.** Optional and not yet adopted; verify when `SENTRY_DSN` is first set.
- **Nominatim usage policy** and the package registries' policies. Verified in the ADRs of P2-T03 and P2-T05, which add those clients.
