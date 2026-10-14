# ADR-006: Static public pages and lighter companions

Date: 2026-10-14 · Status: accepted

## Context

P2-T19 asks for Lighthouse ≥ 90 on the landing page (CLAUDE.md §11.6). The first measurement on the production build gave performance 64, with three causes:

1. The `(marketing)` layout was `force-dynamic` so the header could show the sign-in state. Every visit waited for a Supabase session check: about 900 ms of server response.
2. Every companion was a client component that rebuilt its sprite in the browser during hydration, and drew one `<rect>` per pixel run: 982 of the page's 1,276 DOM nodes and most of its 316 KB of HTML.
3. Client bundles carried code the page never runs: zod (through `lib/brand` → `lib/site` → the validated client env), every `@commitmates/ui` component behind the barrel export, and the Dev Card view before any result exists.

## Decision

- **Sign-in state in the browser.** `AuthStatus` is a client component. It renders the sign-in link by default, so visitors get static HTML and never load the Supabase client. Only when a Supabase auth cookie is present does it import the browser client, read the session and show the member's login. This only decides what the header shows: guards, actions and RLS still verify the session on the server. The `(marketing)` layout is no longer `force-dynamic`, so `/`, `/privacy`, `/terms`, `/attribution`, `/robots.txt` and `/sitemap.xml` are prerendered. A `/api/me` route was not added, because §10.3 limits route handlers to a fixed list.
- **`CompanionSprite`.** Drawing moved into a component without hooks, used directly wherever a companion's state is fixed (hero, five-state strip, header, 404). `CompanionView` wraps it and adds only the "done, then idle" timer, reading the new `STATE_TIMING` table instead of regenerating frames.
- **One path per color.** The inline sprite merges its runs into one `<path>` per fill (`runsToPaths`), drawing the same pixels with about 10 elements instead of about 140. Theme variables still apply. Standalone sheets (share images, icons) keep their `<rect>` output and snapshots.
- **Smaller client bundles.** `@commitmates/env/public` exposes the site name without zod. `@commitmates/ui` declares `"sideEffects": ["*.css"]` so unused components are tree-shaken. The landing demo loads `DevCardView` only once a result arrives.

## Alternatives considered

- Next.js Cache Components (partial prerendering) with the header in a Suspense boundary: a global configuration change that conflicts with the `dynamic` segment config used by tool, admin and API routes. Too broad for this task.
- Companions as `<img>` sprite sheets with data URIs: one element each, but theme-dependent outline colors would need hex values inside a component (§9.2 forbids raw hex in components) or two images per companion.

## Consequences

- A member sees "Sign in with GitHub" for a moment before their name appears on public pages. Visitors see no change and no layout shift.
- Measured on the production build (`next start`, local machine). Lighthouse reports a CPU benchmark index of about 735 and warns that the machine is slower than its default 4× mobile throttling assumes.
  - **Default throttling:** landing 69. Before these changes: 64.
  - **2× CPU multiplier, per Lighthouse's calibration guidance:** landing 88–92; `/tools/dev-card` 92; `/tools/fyp-check` 91.
  - **Accessibility, best practices and SEO:** 100 on every page measured.
  - **Landing page:** DOM 336 nodes (was 1,276), HTML 139 KB (was 316 KB), JavaScript 185 KB gzipped (was 225 KB).
- **Budgets still unmet locally:**
  - Simulated LCP is 3.3–3.8 s against the 2.5 s target. On localhost every script arrives before the first paint, so the trace counts hydration as render delay.
  - Route JavaScript is 185 KB against the 150 KB target. React and the Next.js runtime account for 117 KB of that.

  Both are re-measured on deployed hardware in P7-T02 and P7-T07.

## Verification

`pnpm verify`; the full Playwright suite (92 tests, desktop and 360 px); Lighthouse 12.8.2 with the Playwright Chromium build, runs repeated because scores vary by about ±5 between runs on this machine.
