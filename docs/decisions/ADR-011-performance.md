# ADR-011: Performance review before launch

Date: 2026-11-04 · Status: accepted

## Context

P7-T02 checks the budgets of CLAUDE.md §11.6 before launch. This record covers the database (P7-T02a) and the web pages (P7-T02b).

## Decision

### Database (P7-T02a)

§11.6 asks that no hot-path query scans a table of more than 10,000 rows sequentially, and §7 that every foreign key is indexed. Both are now tests (`packages/db/src/schema/hot-paths.test.ts`): the large tables are filled with synthetic rows (20,000 per table; 200,000 repositories, the default `crawler.maxRepos`), analyzed, and the plan of each hot-path query is read with `EXPLAIN`: claiming jobs and following one, a member's unread notifications, a conversation page, cache lookups and purges, GitHub users and repositories by login and owner, the Graveyard's country search, metric samples, the audit log page and rate buckets.

Findings and fixes (migration `0071_hot_path_indexes.sql`, additive only):

- **Nine foreign keys had no index**: `university_requests.university_id` and `reviewed_by`, `vouches.university_id`, `departments.created_by` and `merged_into_id`, `invites.created_by`, `reports.target_message` and `resolved_by`, `swap_proposals.university_id`. Deleting a member, a message or a university scanned those tables. Each now has an index, and a test lists any foreign key without one.
- **The country search could not use an index.** Its condition was `search_tsv @@ … or coalesce(topics, '{}') && …`; the `coalesce` hid the column and `topics` had no index, so every country search scanned all of `gh_repos`. A GIN index on `gh_repos.topics` was added and the `coalesce` dropped (a null `topics` overlaps nothing either way); the same was done in the university listing search. At 200,000 repositories the plan is now a BitmapOr over both GIN indexes, about 50 ms on this machine, instead of a full scan.
- Everything else already used its index: the job claim uses the partial `jobs_ready_idx`; the audit log pages by primary key.

### Web (P7-T02b)

Measured on the production build (`next build`, `next start`, this machine). Route JavaScript is the gzipped size of every script a page loads in a modern browser; the 38.6 KB legacy polyfill marked `noModule` is never downloaded there and is left out.

**What the JavaScript is.** About 133 KB of every page is React and the Next.js runtime: react-dom 71.9 KB, the router 35.9 KB, the server-component client 8.8 KB, navigation 8.5 KB, the Turbopack runtime 4.3 KB. Our own code shared by every page is the header (sign-in state, theme toggle, notification badge) 9 KB, tailwind-merge 8.4 KB and the error boundary 5.4 KB.

Changes:

- **The FAQ accordion is native `<details>`.** The Radix accordion (8.9 KB) is replaced inside the `Accordion` component, which keeps its props: the browser opens and closes the sections and exposes their state to assistive technology, and they work before hydration. Several sections can be open at once, as before. This also lightens the alumni and leaderboard pages.
- **Dialogs load when they are needed.** The adoption dialog (Graveyard) and the ask dialog (Gap Finder, Open-Source Starter) are only shown to verified members with someone to adopt from or ask; they now load with `next/dynamic` when rendered, so visitors never download Radix Dialog (9.7 KB).

| Page | Before | After |
| --- | --- | --- |
| `/` | 179.3 KB | 170.4 KB |
| `/tools/graveyard` | 189.0 KB | 179.8 KB |
| `/tools/gap` | 182.8 KB | 169.1 KB |
| `/tools/oss` | 182.6 KB | 168.4 KB |
| `/tools/dev-card`, `compat`, `fyp-check`, `recruiter`, `fairness` | 166–169 KB | unchanged |
| `/privacy`, `/attribution` | 156.2 KB | unchanged |

**Images.** The only `<img>` is the GitHub avatar, with explicit width and height, lazy loading and GitHub's size parameter at twice the display size; companions are inline SVG. Nothing to fix.

**Caching.** Page HTML is `private, no-store`: every response carries its own CSP nonce (ADR-010), so it must not be reused, and it is rendered in 25–90 ms. Static chunks are `public, max-age=31536000, immutable`; `robots.txt` and the sitemap are prerendered. ISR is not used, because a cached page would repeat a nonce.

**Lighthouse 12.8.2** (Playwright Chromium, three runs per page; scores vary by about ±5 on this machine):

- Default mobile throttling (4× CPU): landing 70–75, `/tools/dev-card` 72–83. Lighthouse reports this machine slower than its 4× assumption, as in ADR-006.
- 2× CPU, per Lighthouse's calibration guidance: landing 89–92, `/tools/dev-card` 90–94, `/tools/graveyard` 90, `/privacy` 95–97.
- Accessibility, best practices and SEO 100 on every page; layout shift 0; total blocking time 54–229 ms at 2×.

**LCP.** The largest element is body text on every page measured (no image or font request on the path). In the recorded trace it paints about 0.3 s after navigation (first byte 35 ms, render delay 230–260 ms); Lighthouse's simulated LCP is 2.6–3.3 s, because on localhost every script arrives before the first paint and the simulation replays all of them over its slow-4G model.

**Budgets still unmet here.** Route JavaScript is 156–180 KB against 150 KB: the framework alone takes 133 KB, leaving 17 KB for the header, styles helper and any page. Simulated LCP exceeds 2.5 s and default-throttled performance is below 90 on this machine. All three are re-measured on deployed hardware in P7-T07.

## Alternatives considered

- **Only checking that an index exists.** Rejected: the country search had a usable full-text index and still scanned, because of how its condition was written. Reading real plans on realistic volumes catches that.
- **Dropping the `OR` by running two queries and merging.** Not needed once both sides are indexable.
- **Building with webpack instead of Turbopack.** Measured: 199–209 KB per page, larger than Turbopack's 156–180 KB. Kept Turbopack.
- **`cn` without tailwind-merge in the browser.** Server and browser must produce the same class names or hydration mismatches, so tailwind-merge can only go everywhere at once, which needs every `className` override checked by hand. Not worth 8.4 KB before launch.
- **Replacing Radix Tabs (10 KB, Graveyard scope tabs).** The tabs are a real keyboard widget with roving focus; rewriting them saves little and risks accessibility.

## Consequences

- Hot-path plans and foreign-key indexes are checked on every test run; a new query written in a way the planner cannot index fails here.
- The test file takes about 30 seconds, most of it inserting the synthetic rows.
- Ask and adoption buttons appear once their dialog's code has loaded (a few milliseconds after the panel); tests wait for them.

## Verification

Plans read with `EXPLAIN` and `EXPLAIN ANALYZE` on the local Supabase Postgres on 2026-11-04 (synthetic data in a rolled-back transaction, and in the test databases). Bundles, headers and Lighthouse measured on 2026-11-04 against `next start` on port 3200; affected e2e specs (landing, Graveyard, Gap Finder, Open-Source Starter, adoption, alumni, leaderboards, campus) pass.
