# CLAUDE.md — CommitMates

Oct 13, 2026 · @lambda

## 0. How to use this file

This file is the complete specification and instruction set for building CommitMates. Claude Code loads it automatically at the start of every session. It holds everything: rules, architecture, data model, all 22 feature specs, the design system, the roadmap with checkboxes, and the changelog.

"CommitMates" is a working name. To rename it, search-and-replace `CommitMates` and `commitmates` across the repo, then update `NEXT_PUBLIC_SITE_NAME`.

### 0.1 Map of this file

| § | Contents | When to use it |
| --- | --- | --- |
| 0 | How to use this file, session protocol | Every session |
| 1 | Product: vision, problems, personas, tiers, feature map | Context for every decision |
| 2 | Non-negotiable rules | Always |
| 3 | Tech stack | Adding a dependency or service |
| 4 | Repository layout, package boundaries | Creating files |
| 5 | Architecture: flows, jobs, settings, GitHub client, security, privacy | Infrastructure tasks |
| 6 | Live data sources | Anything touching external data |
| 7 | Data model | Any schema change |
| 8 | Feature specs F1–F22 | Before any feature task (each task names its F#) |
| 9 | Design system | Any UI task |
| 10 | Coding conventions | Always |
| 11 | Testing and performance | Always |
| 12 | Git and GitHub workflow | After every task |
| 13 | Stop and ask | When blocked or unsure |
| 14 | Environment variables and commands | Setup, new config |
| 15 | Templates, Definition of Done, glossary | Finishing tasks |
| 16 | Roadmap: phases, tasks, acceptance criteria | Start of every session |
| 17 | Changelog | After every task |

### 0.2 Files you maintain while building

This file describes what to build. The files below describe what was actually built. You create them in P0 and keep them current in the same commit as the code they describe.

- `docs/ALGORITHMS.md`: every formula as implemented, its settings keys, its tests.
- `docs/DATA_SOURCES.md`: every external source, endpoint, policy, refresh cadence, license, attribution.
- `docs/PRIVACY.md`: every personal-data field, why it exists, retention, deletion path.
- `docs/decisions/ADR-NNN-*.md`: one Architecture Decision Record per significant choice (template in §15).
- `docs/runbooks/*.md`: step-by-step guides for humans (deploy, backup, restore, rotate secrets).

If any of these conflict with this file, this file wins. Fix the doc and note it in the changelog.

### 0.3 Start of every session

1. Read this whole file, especially §16 (Roadmap) and the top of §17 (Changelog).
2. Run these commands and read the output:

```bash
git status
git branch --show-current
git log --oneline -15
```

3. Check the state:
   - The working tree must be clean. If it is not, inspect the diff. Finish it if it belongs to the current task; otherwise `git stash` it and record that in the changelog.
   - You must be on the current phase branch (§12.1). If it does not exist, create it from an up-to-date `main`.
   - If the top of §17 has an unresolved `BLOCKED:` line, ask the human whether it is resolved before doing anything else.
4. Find the first unchecked task in §16. That is your task. Never skip ahead and never work on two tasks at once.
5. Read every section the task references (F-numbers in §8, sections of §9, §5, §7).

### 0.4 Post a plan before writing code

```text
TASK: P<phase>-T<task> — <title>
GOAL: <one sentence>
SPEC: <sections of this file you follow, e.g. §8 F7, §9.6>
FILES: <files to create or modify>
SCHEMA: <tables, columns, indexes, migrations — or "none">
SETTINGS: <new settings keys with defaults — or "none">
SOURCES: <external APIs touched — or "none">
TESTS: <unit / integration / e2e tests to add>
RISKS: <anything uncertain; if a risk matches §13, stop and ask instead>
```

### 0.5 While implementing

- Implement the task completely. Real logic, real data paths, real error handling, real copy. No `TODO`, no `throw new Error("not implemented")`, no placeholder text, no fake data.
- A task too large for one commit: split it into subtasks inside §16 (P2-T09a, P2-T09b). Commit after each subtask, and every commit must pass `pnpm verify`.
- A new dependency: check its license against §2.2 and record it in an ADR.
- A new number that controls behavior: make it a settings key. Add it to the seed migration and to the catalog in §5.5.
- A spec that turns out to be wrong or impossible: stop, explain why, propose the fix, and wait (§13).

### 0.6 Finishing a task

1. Run `pnpm verify`. It must pass. If the task touches a flow covered by Playwright, also run `pnpm test:e2e`.
2. Update the maintained docs the task touched (§0.2).
3. Tick the task in §16 and add one line at the top of §17.
4. Commit and push following §12.
5. Post the completion report below.
6. Continue with the next task unless the human said stop. If the next task is marked **\[HUMAN\]**, post exact step-by-step instructions for the human and stop.

### 0.7 Completion report

```text
DONE: P<phase>-T<task> — <title>
COMMIT: <short sha> on <branch> (pushed)
CHANGED: <key files>
VERIFY: lint ✓ typecheck ✓ checks ✓ unit ✓ build ✓ [e2e ✓]
SETTINGS ADDED: <keys or none>
NOTES: <follow-ups, caveats>
NEXT: P<phase>-T<task+1> — <title>
```

### 0.8 End of a phase

When every task in a phase is ticked, follow §12.4: open a pull request, wait for CI, merge, tag. Then create the next phase branch.

### 0.9 Editing this file

You may edit this file only to:

- tick roadmap checkboxes and add changelog lines;
- split a task into subtasks;
- add new settings keys to the catalog in §5.5;
- fix a factual error, with a changelog line explaining it.

Never weaken a rule in §2, change a product decision, or remove a feature without the human's explicit approval.

## 1. Product

### 1.1 Vision

CommitMates is a university-verified network for student developers. It turns real GitHub activity into a living profile, finds you the right partner at your own university, and helps you actually finish things together: projects, code reviews, open-source contributions and final-year projects (FYPs).

The one-line pitch: **find a coding partner at your uni, and actually finish something together.**

### 1.2 Problems and our answers

| # | Problem | Our answer | Features |
| --- | --- | --- | --- |
| P1 | Partner-search posts on forums go stale; pairs rarely finish anything | University-scoped matching, shared streaks, a pair companion | F11, F12, F13 |
| P2 | Platforms trust self-declared skills | Skills verified from code, dependencies and registry metadata | F1, F11, F16 |
| P3 | Students struggle to find FYP ideas, group members and supervisors | Idea checker, FYP board, seniors' past projects | F9, F17, F22 |
| P4 | Work in group projects is unequal | Group Fairness Report | F4 |
| P5 | Newcomers don't know where to start in open source; maintainers often don't respond | Open-Source Starter with responsiveness gates and campus seniors | F8 |
| P6 | Students want more code review; reviewers want recognition | Review Exchange with verified reviews and credits | F15 |
| P7 | Alumni networks have low engagement; mentoring pairs rarely continue | Alumni Quick Asks: short, routed, one-off questions | F20 |
| P8 | Promising student projects get abandoned | Project Graveyard with revivability scoring and adoption | F7, F14 |
| P9 | Recruiters skim GitHub profiles in seconds | Recruiter-Ready Score with evidence and fixes | F3 |
| P10 | Students don't know what their project is missing or who could fill the gap | Gap Finder | F5 |
| P11 | People want a fun, low-commitment way to check if they'd work well together | Compatibility Check | F2 |

### 1.3 Personas

- **Student builder (primary).** 2nd–4th year, has a GitHub with a few projects. Wants teammates, FYP direction, internships.
- **Beginner.** Almost-empty GitHub. Wants a study buddy and a first contribution. Never shame an empty profile; guide it.
- **Alumnus.** Busy. Will answer a short question, won't commit to long mentoring.
- **Supervisor or faculty member.** Wants FYP ideas that aren't duplicates and teams that work fairly.
- **Organizer.** Runs hackathons and needs balanced teams quickly.

### 1.4 Unlock tiers

- **Day-one:** works for a single user with an empty database, using only live public data. These features are the growth engine and the data engine: every analysis adds anonymous samples that make the dynamic settings real.
- **Foundation:** university verification. Required by every campus feature.
- **Campus:** needs `unlock.<feature>.minMembers` verified members at one university (value from settings).
- **Crowd:** needs many members and/or the crawled country index.

A locked feature renders an **Unlock card** instead of the feature. It shows:

- current value and required value, e.g. "14 / 20 verified members";
- a progress bar;
- an invite action that copies a link with `?ref=<uni-slug>`;
- one sentence on what unlocks.

The required value always comes from settings, never from code. Locked features never show empty screens or fake content.

### 1.5 Feature map

| F# | Feature | Tier | Built in | One line |
| --- | --- | --- | --- | --- |
| F1 | Dev Card | Day-one | Phase 2 | Auto-profile, coding personality, generated companion |
| F2 | Compatibility Check | Day-one | Phase 2 | Two GitHub users → shareable partner compatibility breakdown |
| F3 | Recruiter-Ready Score | Day-one | Phase 2 | Rule-based profile audit with evidence and fixes |
| F4 | Group Fairness Report | Day-one | Phase 2 | Who did what in a team repo, neutrally presented |
| F5 | Gap Finder | Day-one (+ campus layer) | Phase 2, 5 | What a repo lacks vs similar repos; who at your uni can fill it |
| F6 | Taxonomy engine | Shared service | Phase 2 | Learns topics and dependencies related to any search term |
| F7 | Project Graveyard | Day-one (global), Campus (uni), Crowd (country) | Phase 2, 5, 6 | Find inactive but revivable projects |
| F8 | Open-Source Starter | Day-one (+ campus layer) | Phase 2, 5 | Beginner issues from responsive projects in your stack |
| F9 | FYP Idea Checker | Day-one | Phase 2 | Finds similar existing projects for an idea |
| F10 | University verification | Foundation | Phase 3 | Email OTP or vouching against a live university list |
| F11 | Matching + Discover | Campus | Phase 4 | Similar or complementary partners at your uni |
| F12 | Chat + Safety | Campus | Phase 4 | Message requests, realtime chat, trust limits, reports |
| F13 | Shared streaks + pair companion | Campus | Phase 4 | Pair accountability with an evolving shared pet |
| F14 | Adoptions + uni listings | Campus | Phase 5 | Owners list projects for adoption; revivals tracked |
| F15 | Review Exchange | Campus | Phase 5 | Give a verified review, get a review |
| F16 | Verified Skill Swap | Campus | Phase 5 | Teach a verified skill, learn another, including 3-way swaps |
| F17 | Senior's Legacy | Campus | Phase 5 | Browse seniors' and alumni projects; ask the author |
| F18 | Country crawler + geocoding | Crowd | Phase 6 | Builds the country index for country-level search |
| F19 | Leaderboards | Crowd | Phase 6 | Per-capita university and department boards |
| F20 | Alumni Quick Asks | Crowd | Phase 6 | Short questions routed to the best-matched alumni |
| F21 | Squad Builder | Crowd | Phase 6 | Balanced hackathon teams from skill clusters |
| F22 | FYP Board | Crowd | Phase 6 | Ideas, supervisors, team formation, duplicate checks |

### 1.6 Non-goals

We will never build:

- a job board or recruiter marketplace;
- a LinkedIn-style feed with likes and followers;
- analysis of private repository content;
- any AI or LLM feature;
- ads, or the sale or sharing of user data;
- public rankings of people who did not opt in.

### 1.7 Success metrics

All computed from our own database and shown on the admin dashboard (`/admin/metrics`):

| Metric | Definition |
| --- | --- |
| Activation | % of signed-in users who complete university verification within 7 days |
| Tool conversion | % of day-one tool sessions that lead to sign-up within 24 hours |
| Match quality | % of accepted message requests that reach `matching.successMessages` messages from both sides |
| Streak retention | Median length of active pairs, in days |
| Revivals | Adoptions whose fork received commits after adoption |
| Review quality | % of review requests settled as helpful |
| Alumni responsiveness | Median hours to first answer |
| Fairness usage | Fairness reports generated per week |

## 2. Non-negotiable rules

These rules override convenience, speed and any other section. Breaking one is a failed task, even if tests pass.

### 2.1 No AI or LLM services

**Rule.** No OpenAI, Anthropic, Google Gemini, Hugging Face inference, Replicate, embedding APIs, or any hosted or local language model. No AI SDK packages.

**What to build instead.** Classic algorithms in `packages/algorithms`:

- statistics: percentiles, coefficient of variation, Gini coefficient, histogram intersection;
- information retrieval: TF-IDF, BM25, YAKE keyword extraction;
- similarity: cosine, Jaccard;
- clustering: k-means with silhouette selection;
- graphs: depth-limited cycle search;
- optimization: greedy assignment;
- rule engines with weighted rules.

**Violations.** Summarizing a README with a model. Using embeddings for matching. Generating icebreakers or advice with AI. Icebreakers come from templates filled with real shared signals.

### 2.2 Free and open only

**Allowed licenses.**

- Code: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, MPL-2.0 (only when the dependency's files stay unmodified).
- Fonts: OFL-1.1.
- Assets: CC0, CC-BY-4.0 (with attribution on `/attribution`).
- Not allowed in shipped code: GPL, AGPL, SSPL, BUSL, or any "source-available" license.

**Hosted services.** Each must have a free tier that fits the design: Supabase, Vercel Hobby, a free SMTP provider, Sentry free (optional), and the public APIs in §6.

**Free-tier numbers change.** Never hardcode a quota in code. Put it in settings with a description, and verify the current terms in an ADR whenever you adopt or depend on a service.

**Violations.** Adding a paid geocoder. Using an AGPL library. Writing `if (dbSizeMb > 500)` instead of reading `storage.dbBudgetMb`.

### 2.3 Dynamic, never hardcoded

**Rule.** Code must not contain hand-written domain data:

- universities, email domains, countries, cities;
- skills, categories, topics, label names;
- secret patterns, language colors, file-type lists;
- thresholds, weights, limits, intervals.

**Where data comes from instead.**

- Lists come from live sources (§6), synced into the database.
- Numbers come from the Settings Engine (§5.5).
- Small seed vocabularies (for example, words that signal an unfinished project) are settings values. Their defaults live only in the seed migration and are editable at runtime.

**Allowed literals.** HTTP status codes, unit conversions (`MS_PER_DAY`), protocol constants (GitHub header names), schema enum values, job priority classes (§5.4), and literals marked `// allowed-literal: <reason>`.

### 2.4 No fake data outside tests

- No seed users, demo profiles, sample projects, lorem ipsum, or invented statistics.
- Fixtures live only in `**/__fixtures__/**` and are imported only by test files. ESLint enforces this (§10.12).
- Empty states explain what is missing and how it unlocks.

### 2.5 Respect external policies

- **GitHub.** Read rate limits from response headers and `/rate_limit`; never assume them. Never use extra tokens or accounts to raise limits. Back off on secondary limits.
- **Nominatim.** One request per `geocoder.minIntervalMs` app-wide, enforced with a database lock. Identifying User-Agent. No bulk geocoding or autocomplete. Cache forever. OpenStreetMap attribution wherever results are shown. Endpoint configurable via env, so it can be switched without a code change.
- **Package registries.** Identifying User-Agent, one request in flight per registry, long caching.
- **Licenses and attribution.** Every source and asset is credited on `/attribution`.

### 2.6 Privacy first

- **Non-members** (people who never signed up) get no public page and no ranking. Their raw cached data is deleted after `privacy.nonUserRawTtlHours`; only anonymous aggregates remain (§5.12).
- **Sensitive findings** such as leaked secrets are shown only to the authenticated owner. The secret value is never stored.
- **Every member** can export all their data as JSON and hard-delete their account.
- **IP addresses** are never stored raw. Rate-limit keys use `sha256(ip + daily_salt)`.

### 2.7 Least privilege

- GitHub OAuth scopes: `read:user` and `user:email` only. Never `repo`, `write:*` or `admin:*`.
- Private repository content is out of scope. Private contribution counts appear only if the user enabled them on GitHub.
- The server GitHub token is fine-grained with public read-only access.
- The Supabase secret key is used only in server code.

### 2.8 Kind, neutral language

- Never label people: no "freeloader", "lazy", "inactive person", "bad coder".
- A member's repo is "inactive" or "up for adoption", never "abandoned" or "dead".
- Every score comes with evidence and a constructive fix.

### 2.9 Production quality

Every feature is typed, validated, tested, observable, accessible, and works on mobile (360px wide and up) and desktop.

### 2.10 Original brand

- The visual theme is inspired by codemon.pro: a pixel companion, terminal windows, a five-state system.
- Never copy its text, logo, characters, sprites, sounds or layouts.
- All mascots are generated procedurally by our companion engine (§9.5). Nothing may resemble Octocat or any franchise character.

## 3. Tech stack

One language (TypeScript) end to end, one database (Postgres on Supabase), one web deploy (Next.js on Vercel), and no paid services.

**Version policy.** In P0, install the latest stable version of each package, commit the lockfile, and record the major versions in ADR-001. Upgrade only through dedicated `chore(deps)` commits that pass `pnpm verify`.

### 3.1 Choices

| Layer | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Language | TypeScript with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | One language everywhere; shared types | A Python service (two runtimes to host for free) |
| Package manager | pnpm workspaces | Fast, strict dependency graph | npm, yarn |
| Build orchestration | Turborepo | Task caching and pipelines | Nx (heavier) |
| Web framework | Next.js App Router: Server Components, Route Handlers, Server Actions, `after()`, `next/og` | SSR, API, background kick-off and share images in one deploy | Remix, SvelteKit |
| Styling | Tailwind CSS + CSS-variable tokens | Theming, dark and light modes | CSS-in-JS |
| UI primitives | Radix UI, via shadcn/ui-style source copied into `packages/ui` and fully restyled | Accessible, and we own the code | Prebuilt themed kits |
| Variants | class-variance-authority + tailwind-merge | Typed component variants | — |
| Icons | Material Symbols Rounded (Apache-2.0), self-hosted subset | Playful, consistent | — |
| Fonts | Pixelify Sans, Inter, JetBrains Mono (all OFL) via `next/font` | Free, self-hosted at build time | — |
| Motion | CSS `steps()` for sprites; Motion (MIT) for UI transitions | Lightweight | GSAP (license) |
| Database | PostgreSQL on Supabase (prod and staging projects) | Postgres plus Auth, Realtime, pg\_cron, pg\_net and Vault in one free project | Firebase (not SQL) |
| DB driver | `postgres` (postgres.js), with `prepare: false` on the transaction pooler | Works with Supabase's pooler | — |
| ORM | Drizzle ORM + drizzle-kit | Typed SQL, readable migrations | Prisma (heavier engine) |
| Auth | Supabase Auth with the GitHub provider; `@supabase/ssr` | Integrates with RLS and Realtime | Auth.js (separate RLS story) |
| Realtime | Supabase Realtime (Postgres changes + Broadcast) with RLS | Chat and notifications without our own socket server | Self-hosted Socket.IO (needs an always-on server) |
| Search | Postgres full-text search (`tsvector`, `websearch_to_tsquery`) + `pg_trgm` | No extra service | Meilisearch (another host) |
| Jobs | Own Postgres queue with `FOR UPDATE SKIP LOCKED`, `/api/jobs/tick`, pg\_cron + pg\_net trigger in prod, `apps/worker` loop in dev | Free, portable, no Redis | BullMQ (needs Redis) |
| GitHub | `@octokit/core` with REST endpoint methods, paginate, throttling and retry plugins; `@octokit/graphql` | Official clients | — |
| YAML / TOML | `yaml`, `smol-toml` | Linguist, explore topics, gitleaks rules | — |
| RE2 regex | An RE2 engine for JS (`re2-wasm` or `re2`; verify license in ADR) | gitleaks and Linguist patterns are not JS-regex compatible | Plain JS RegExp |
| Markdown | unified, remark-parse, remark-gfm, rehype-sanitize | README analysis, safe rendering | — |
| Time | `date-fns` + `date-fns-tz` | Timezone-correct day boundaries | moment |
| Coordinates → timezone | An offline coordinate-to-timezone library with a permissive license (verify in ADR) | No API calls | Paid timezone APIs |
| Validation | zod | Every boundary | — |
| Email | Nodemailer over SMTP; templates in `packages/email` | Provider-agnostic | Provider SDK lock-in |
| Logging | pino (JSON) | Structured logs | console |
| Error tracking | Sentry free plan, optional, only when `SENTRY_DSN` is set | — | — |
| Unit and integration tests | Vitest, Testing Library, MSW | Fast, ESM-native | Jest |
| End-to-end tests | Playwright + `@axe-core/playwright` | Real browser plus accessibility checks | Cypress |
| Lint and format | ESLint flat config (typescript-eslint, react, jsx-a11y, import), Prettier | — | — |
| Secret scanning | gitleaks CLI in CI | — | — |
| Hosting | Vercel Hobby for web; Dockerfile for any VM as fallback | Free | — |
| CI | GitHub Actions for lint, typecheck, test, build and scans only | Free for public repos | Running app workloads on Actions (not allowed) |

### 3.2 Hosting realities

- **Function time limits.** Free hosting limits how long a request can run. Every request handler and job runs under a deadline from settings (`jobs.tickBudgetMs`, `jobs.interactiveBudgetMs`). Long work continues in follow-up jobs.
- **Idle pausing.** Supabase free projects pause when idle. Our pg\_cron ticks create real activity every minute, but backups are still mandatory (P7-T05).
- **Non-commercial.** Vercel Hobby is for non-commercial personal use. If the project ever earns money (including donations), move web hosting to a paid plan or the Docker path and record it in an ADR.
- **Quotas.** Email sends, database size and Realtime connections are limited on free tiers. Each has a settings key and an admin health indicator (§5.13).

### 3.3 Dependency rules

- Before adding a package: check its license (§2.2), maintenance (a release in the last 12 months or a stable, finished API), and bundle impact for client code.
- `pnpm check:licenses` fails the build on any dependency outside the allow-list.
- Never add a package that phones home, collects telemetry by default, or requires an account.

## 4. Repository layout

A pnpm + Turborepo monorepo: two apps (web, worker) and ten packages with strict import boundaries.

### 4.1 Tree

```text
commitmates/
├─ CLAUDE.md                       # this file
├─ README.md  LICENSE
├─ package.json                    # root scripts (§14.2), "packageManager" field
├─ pnpm-workspace.yaml  turbo.json
├─ .nvmrc  .editorconfig  .gitignore  .gitleaks.toml  .env.example
├─ Dockerfile                      # web + worker image (self-host fallback)
├─ .github/
│  ├─ workflows/ci.yml
│  ├─ pull_request_template.md
│  └─ dependabot.yml
├─ apps/
│  ├─ web/
│  │  ├─ next.config.ts            # security headers, CSP, image domains
│  │  ├─ middleware.ts             # session refresh, route protection
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ (marketing)/        # /, /about, /faq, /attribution, /privacy, /terms
│  │     │  ├─ (tools)/tools/      # day-one tools, no sign-in needed
│  │     │  │  ├─ dev-card/  compat/  recruiter/  fairness/  gap/
│  │     │  │  ├─ graveyard/  oss/  fyp-check/
│  │     │  ├─ (app)/              # members area: signed in + verified
│  │     │  │  ├─ onboarding/  home/  discover/  inbox/  streaks/  reviews/
│  │     │  │  ├─ swaps/  legacy/  uni/[slug]/  leaderboards/  alumni/
│  │     │  │  ├─ events/  fyp/  settings/
│  │     │  ├─ (admin)/admin/      # health, metrics, settings, moderation, universities, jobs
│  │     │  ├─ u/[login]/          # member public profile (visibility-aware)
│  │     │  ├─ auth/callback/route.ts
│  │     │  └─ api/
│  │     │     ├─ tools/[tool]/route.ts        # POST: start an analysis
│  │     │     ├─ jobs/[id]/events/route.ts    # GET: SSE progress
│  │     │     ├─ jobs/tick/route.ts           # POST: internal, secret-protected
│  │     │     ├─ me/export/route.ts           # GET: data export
│  │     │     └─ og/[kind]/route.tsx          # share images
│  │     ├─ server/                # server-only: actions/, auth.ts, guards.ts, rate.ts
│  │     ├─ components/<domain>/   # app compositions (design system lives in packages/ui)
│  │     ├─ copy/<domain>.ts       # all user-facing strings
│  │     └─ lib/                   # client-safe helpers
│  └─ worker/
│     └─ src/index.ts              # loop: runTick() every jobs.workerIntervalMs (dev, self-host)
├─ packages/
│  ├─ algorithms/   src/{stats,similarity,ir,yake,bm25,gini,kmeans,graph,scoring,text,time,histogram}/
│  ├─ github/       src/{client,cache,budgets,pacer,errors,queries,schemas}/
│  ├─ sources/      src/{hipo,linguist,explore,disposable-emails,gitleaks,geocoder,timezone,registries/{npm,pypi,crates,pub,packagist}}/
│  ├─ db/           src/{schema,queries,settings,crypto}/  migrations/
│  ├─ jobs/         src/{runner,registry,schedules,enqueue}/
│  ├─ core/         src/<domain>/{service.ts,jobs.ts,schemas.ts}  (one folder per feature)
│  ├─ ui/           src/{tokens.css,components,companion,charts,icons}/
│  ├─ email/        src/{templates,transport}/
│  ├─ env/          src/{server,client,worker}.ts
│  └─ config/       tsconfig, eslint, prettier, vitest presets
├─ supabase/config.toml            # local stack (auth providers, ports, mail catcher)
├─ e2e/                            # Playwright specs and helpers
├─ scripts/                        # record-fixtures, check-contrast, check-licenses, check-hardcoded, db-backup
└─ docs/                           # maintained docs (§0.2)
```

### 4.2 Core domain folders

`packages/core/src/` contains one folder per domain, each with `service.ts` (public functions), `jobs.ts` (job handlers), `schemas.ts` (zod) and `__tests__/`:

`profiles`, `persona`, `compat`, `recruiter`, `fairness`, `gap`, `taxonomy`, `graveyard`, `oss`, `fyp`, `universities`, `verification`, `matching`, `chat`, `safety`, `streaks`, `adoptions`, `reviews`, `swaps`, `legacy`, `crawler`, `geocoding`, `leaderboards`, `alumni`, `squads`, `notifications`, `privacy`, `admin`, `metrics`.

### 4.3 Package boundaries

| Package | May import | Must not import | Public API |
| --- | --- | --- | --- |
| `algorithms` | nothing internal | anything with I/O | Pure functions and types |
| `env` | zod | other internal packages | `serverEnv`, `clientEnv`, `workerEnv` |
| `db` | `env` | `core`, `jobs`, `github`, `sources` | `db`, schema, query modules, `getSetting`, `setComputed`, crypto |
| `github` | `db`, `env` | `core`, `jobs`, `sources` | `githubFor(identity)`, typed query functions, errors |
| `sources` | `db`, `env`, `github` | `core`, `jobs` | One module per source: `fetchRaw`, `normalize`, `sync` |
| `jobs` | `db`, `env` | `core` | `enqueue`, `runTick`, `registerHandler`, priorities |
| `core` | `algorithms`, `db`, `env`, `github`, `sources`, `jobs`, `email` | `apps/*`, `ui` | Domain services and job handlers |
| `email` | `env` | everything else | `sendEmail(template, data)` |
| `ui` | React only | any server code | Components, tokens, companion |
| `apps/web` | all packages | — | — |
| `apps/worker` | `jobs`, `core`, `env` | `ui` | — |

ESLint `import/no-restricted-paths` enforces this table. Server-only modules start with `import "server-only"`.

### 4.4 Where new code goes

- A formula or scoring rule → `packages/algorithms`, pure and tested.
- A call to an external API → `packages/github` or `packages/sources`.
- Business logic that combines data, algorithms and storage → `packages/core/<domain>`.
- A reusable visual component → `packages/ui`.
- A page, server action or route → `apps/web`.
- A string the user reads → `apps/web/src/copy/<domain>.ts`.

## 5. Architecture

Everything runs in one Next.js deploy plus one Postgres database. Background work runs in a Postgres-backed job queue that pg\_cron ticks every minute.

### 5.1 System overview

```text
 Browser ──HTTPS──► Next.js (Vercel)
   │                 ├─ Server Components / Server Actions ──► core services ──► Postgres (Supabase)
   │                 ├─ POST /api/tools/* ──► enqueue job + after(runTick)
   │                 ├─ GET  /api/jobs/[id]/events (SSE) ──► polls the jobs row
   │                 └─ POST /api/jobs/tick ◄── pg_cron + pg_net (every minute, secret header)
   │
   └─ Supabase Realtime (WebSocket, RLS) ◄── chat messages, notifications

 core ──► packages/github ──► GitHub REST + GraphQL (ETag cache, budgets, search pacer)
      ──► packages/sources ──► Hipo, Linguist, github/explore, registries, gitleaks, Nominatim
      ──► packages/algorithms (pure functions)
```

### 5.2 Environments

| Env | Web | Database | Job trigger | GitHub OAuth app |
| --- | --- | --- | --- | --- |
| local | `pnpm dev` | Supabase CLI stack (Docker) | `apps/worker` loop | Dev app, callback on localhost |
| staging | Vercel preview deployments (stable alias) | Supabase project #2 | pg\_cron → staging URL | Staging app |
| prod | Vercel production | Supabase project #1 | pg\_cron → prod URL | Prod app |

Migrations run on staging first, then prod (`docs/runbooks/deploy.md`).

### 5.3 Request lifecycle for day-one tools

Example: `POST /api/tools/dev-card` with `{ "login": "someone" }`.

1. **Validate.** Parse the body with zod. Logins match `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`.
2. **Rate limit.** Take a token from `tool:<tool>:ip:<ipHash>`, and also `tool:<tool>:user:<id>` when signed in (§5.10). If empty, return 429 with `retry-after`.
3. **Cache check.** Look up `analysis_cache(kind, subject_key, params_hash)`. If it hasn't expired, return `{ "status": "done", "result": … }`.
4. **Enqueue.** Call `enqueue(type, payload, { idempotencyKey, priority: PRIORITY.INTERACTIVE })`. If the key already exists, `enqueue` returns the existing job.
5. **Respond and start.** Return `{ "status": "queued", "jobId": … }`, then call `after(() => runTick({ budgetMs: jobs.interactiveBudgetMs, onlyJobId }))` so the job starts immediately instead of waiting for the next cron tick.
6. **Stream progress.** The client opens `EventSource("/api/jobs/<id>/events")`. The handler polls the job row every `jobs.ssePollMs` and emits `progress`, `done` or `error` events. It closes cleanly after `jobs.sseMaxMs`, and EventSource reconnects automatically. It follows continuation children through `parent_id`.
7. **Show state.** queued or running → companion **Working**; waiting for a rate limit → **Waiting** with an ETA from `run_at`; done → **Done** and render the result; failed or dead → **Error** with the job's `user_message`.

### 5.4 Job system

**Table.**

```sql
create type job_status as enum ('queued','running','done','failed','dead','cancelled');
create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  status job_status not null default 'queued',
  priority smallint not null default 0,          -- higher runs first
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null,
  locked_at timestamptz,
  locked_by text,
  idempotency_key text unique,
  progress jsonb,                                -- {step, pct, message} for SSE
  result_ref jsonb,                              -- pointer to the stored result
  last_error text,
  user_message text,
  parent_id uuid references jobs(id),            -- continuation chain
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs (priority desc, run_at) where status = 'queued';
create index jobs_running_idx on jobs (locked_at) where status = 'running';
create index jobs_parent_idx on jobs (parent_id);
```

**Claim query.**

```sql
update jobs
set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
where id in (
  select id from jobs
  where status = 'queued' and run_at <= now()
    and ($3::uuid is null or id = $3)
  order by priority desc, run_at
  limit $2
  for update skip locked
)
returning *;
```

**Handler contract** (`packages/jobs`).

```ts
export type JobContext = {
  deadline: number;                                  // epoch ms; stop before this
  now: () => Date;
  progress(p: { step: string; pct?: number; message?: string }): Promise<void>;
  log: Logger;
  github: (identity: TokenIdentity) => GitHubClient; // budget-aware
  settings: <K extends SettingKey>(key: K) => Promise<SettingValue<K>>;
};

export type JobOutcome =
  | { kind: 'done'; resultRef?: unknown }
  | { kind: 'continue'; payload: unknown; delayMs?: number }   // re-enqueue the remainder
  | { kind: 'wait'; until: Date; reason: 'rate_limit' | 'dependency' };

export interface JobHandler<P> {
  type: string;
  schema: z.ZodType<P>;        // payload validated before run
  maxAttempts?: number;        // default: jobs.maxAttempts.default
  priority: number;            // a PRIORITY constant
  run(payload: P, ctx: JobContext): Promise<JobOutcome>;
}
```

**Runner rules.**

1. Reaper first: jobs `running` with `locked_at < now − jobs.staleLockMs` go back to `queued`.
2. Evaluate schedules (below).
3. Claim up to `jobs.claimBatchSize` jobs and run them. Stop claiming when less than `jobs.minRemainingMs` remains before the deadline.
4. Parse each payload with its handler's schema. A parse failure marks the job `dead` with the reason.
5. Outcomes:
   - `done` → status `done`, store `result_ref`.
   - `continue` → current job `done`; insert a child job with `parent_id`, same type, the new payload, `run_at = now + delayMs`, and the progress copied forward.
   - `wait` → status `queued`, `run_at = until`, and `attempts` decremented so waiting does not consume an attempt.
6. Errors:
   - Retryable (network, 5xx, `ExternalServiceError`) → `queued` with `run_at = now + jobs.backoffBaseMs × 2^(attempts−1) × jitter(0.8–1.2)`.
   - `RateLimitError(resetAt)` → treated like `wait` until `resetAt + 5s`.
   - Non-retryable (`ValidationError`, `NotFoundError`, `ForbiddenError`) → `failed` with a friendly `user_message`.
   - `attempts >= max_attempts` → `dead`, shown on `/admin/jobs`.
7. Every handler must be idempotent: running it twice with the same payload produces the same stored result.

**Priority classes** (protocol constants, allowed in code).

| Constant | Value | Used for |
| --- | --- | --- |
| `PRIORITY.INTERACTIVE` | 100 | A user is waiting on screen |
| `PRIORITY.USER_BG` | 50 | Member background work (vectors, verification follow-ups, review checks) |
| `PRIORITY.MAINTENANCE` | 20 | Syncs, recompute, purges, digests |
| `PRIORITY.CRAWL` | 0 | Country crawler |

**Schedules.**

```sql
create table job_schedules (
  name text primary key,
  cron_expr text not null,
  job_type text not null,
  payload jsonb not null default '{}',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz not null
);
```

On every tick, rows with `next_run_at <= now()` enqueue their job with idempotency key `schedule:<name>:<next_run_at ISO>`, and `next_run_at` advances using a cron-expression parser. Schedules are inserted by migrations; admins can toggle `enabled` on `/admin/jobs`.

**Production trigger** (migration applied only to staging and prod; secrets live in Supabase Vault, never inline).

```sql
select cron.schedule('jobs-tick', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tick_url'),
    headers := jsonb_build_object(
      'x-tick-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret')),
    timeout_milliseconds := 5000
  );
$$);
```

The tick route compares `x-tick-secret` with `JOB_TICK_SECRET` in constant time, then runs `runTick({ budgetMs: jobs.tickBudgetMs })`.

**Job catalog.** Handlers live in `packages/core/src/<domain>/jobs.ts`.

| Type | Feature | Trigger | Idempotency key |
| --- | --- | --- | --- |
| `analyze_profile` | F1 | Tool request, member refresh | `analyze_profile:<login>:<hour>` |
| `compat_check` | F2 | Tool request | `compat:<loginA>:<loginB>:<hour>` (logins sorted) |
| `recruiter_report` | F3 | Tool request | `recruiter:<login>:<hour>` |
| `fairness_report` | F4 | Tool request | `fairness:<owner/repo>:<hour>` |
| `gap_analysis` | F5 | Tool request | `gap:<owner/repo>:<day>` |
| `taxonomy_expand` | F6 | Cache miss | `taxonomy:<term>:<day>` |
| `graveyard_search` | F7 | Search request | `graveyard:<scope>:<hash(query)>:<hour>` |
| `oss_search` | F8 | Request | `oss:<hash(params)>:<hour>` |
| `fyp_check` | F9 | Request | `fyp:<hash(text)>:<day>` |
| `send_otp` | F10 | Verification start | `otp:<verificationId>:<sendCount>` |
| `compute_skill_vector` | F11 | Sign-in, weekly refresh | `vector:<userId>:<day>` |
| `match_daily` | F11 | Nightly schedule | schedule key |
| `tune_match_weights` | F11 | Nightly schedule | schedule key |
| `compute_trust` | F12 | Nightly schedule | schedule key |
| `streak_check` | F13 | Hourly schedule (batches by timezone) | `streak:<pairId>:<date>` |
| `suggest_listings` | F14 | Weekly per member | `listings:<userId>:<week>` |
| `track_revivals` | F14 | Daily schedule | schedule key |
| `verify_review` | F15 | Review submitted, then retries | `review:<requestId>:<attempt>` |
| `expire_reviews` | F15 | Hourly schedule | schedule key |
| `propose_swaps` | F16 | Nightly schedule | schedule key |
| `legacy_refresh` | F17 | Weekly schedule | schedule key |
| `crawl_country` | F18 | Continuous, low priority | `crawl:<cursorId>:<page>` |
| `geocode_pending` | F18 | Every-minute schedule | schedule key |
| `leaderboard_weekly` | F19 | Weekly schedule | schedule key |
| `alumni_route`, `alumni_sla` | F20 | Question created; hourly | `alumni:<questionId>:<round>` |
| `role_transition` | F20 | Daily schedule | schedule key |
| `form_squads` | F21 | Organizer action | `squads:<eventId>:<version>` |
| `fyp_detect_projects` | F22 | Weekly schedule | schedule key |
| `sync_linguist`, `sync_explore`, `sync_hipo`, `sync_disposable_emails`, `sync_gitleaks` | Sources | Weekly schedule | schedule key |
| `enrich_packages` | Sources | After manifest parsing | `pkg:<ecosystem>:<name>:<month>` |
| `recompute_settings` | Settings | Nightly schedule | schedule key |
| `purge_non_user_raw` | Privacy | Hourly schedule | schedule key |
| `rotate_salts` | Privacy | Daily schedule | schedule key |
| `cleanup_rate_buckets` | Security | Daily schedule | schedule key |
| `digest_email` | Notifications | Daily per timezone batch | `digest:<userId>:<date>` |
| `reencrypt_tokens` | Security | Manual (rotation runbook) | `reencrypt:<keyVersion>` |

### 5.5 Settings engine

Every number, weight, threshold and seed vocabulary lives in the `settings` table. That makes the app dynamic: values start as defaults and switch to values computed from real data once enough data exists.

**Tables.**

```sql
create table settings (
  key text primary key,
  value_type text not null check (value_type in
    ('number','integer','boolean','string','string[]','number[]','json')),
  default_value jsonb not null,
  computed_value jsonb,
  override_value jsonb,
  sample_size integer not null default 0,
  min_sample integer not null default 0,     -- 0 = never computed; default or override only
  computed_at timestamptz,
  unit text,
  description text not null,
  updated_at timestamptz not null default now()
);

create table settings_history (
  id bigserial primary key,
  key text not null references settings(key),
  field text not null check (field in ('computed','override','default')),
  old_value jsonb,
  new_value jsonb,
  source text not null check (source in ('recompute','admin','migration')),
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
```

**Resolution order.** `override_value` → `computed_value` (only when `min_sample > 0` and `sample_size >= min_sample`) → `default_value`.

**Code.**

```ts
// packages/db/src/settings/keys.ts — keys and types ONLY; defaults live in migrations
export const SettingKeys = {
  'jobs.tickBudgetMs': 'integer',
  'graveyard.unfinishedTerms': 'string[]',
  'matching.weights': 'json',
  // … every key in the catalog below
} as const;
export type SettingKey = keyof typeof SettingKeys;

// packages/db/src/settings/get.ts
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
export async function setComputed(key: SettingKey, value: unknown, sampleSize: number): Promise<void>;
export async function setOverride(key: SettingKey, value: unknown | null, actorUserId: string): Promise<void>;
```

- JSON-typed settings have a zod schema in `packages/db/src/settings/schemas.ts`; values are parsed on read.
- Values are cached in memory per request (`React.cache`) or per tick (a Map). Never longer than `settings.cacheMs`.
- An unknown key is a compile error and throws `ConfigError` at runtime.
- Each new key gets an `insert … on conflict (key) do nothing` in a migration named `*_settings_<topic>.sql`.
- `recompute_settings` (nightly) recomputes every key with `min_sample > 0` from `metric_samples` or domain tables, writes `computed_value`, `sample_size` and `computed_at`, and adds a `settings_history` row when the value changes by more than `settings.historyMinDelta` (relative).
- Admins override values on `/admin/settings`. Every override writes `settings_history` and `audit_log`.

**Naming.** `<domain>.<thing>[.<qualifier>]`, camelCase segments, the unit in the name when ambiguous (`Ms`, `Hours`, `Days`, `Pct`).

### 5.5.1 Settings catalog

These are the seed defaults. "Computed" names the data the nightly job uses once `min_sample` is reached. Add every new key to this table in the same commit that introduces it.

**Platform**

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `settings.cacheMs` | integer | 30000 | — | Max in-memory age of a setting |
| `settings.historyMinDelta` | number | 0.02 | — | Relative change that writes a history row |
| `jobs.tickBudgetMs` | integer | 45000 | — | Tick deadline; must stay below the hosting function limit (verify in ADR) |
| `jobs.interactiveBudgetMs` | integer | 25000 | — | Budget for `after()` interactive runs |
| `jobs.minRemainingMs` | integer | 5000 | — | Stop claiming below this |
| `jobs.claimBatchSize` | integer | 3 | — | Jobs claimed per loop |
| `jobs.staleLockMs` | integer | 300000 | — | Reaper threshold |
| `jobs.maxAttempts.default` | integer | 5 | — | Default attempts per job |
| `jobs.backoffBaseMs` | integer | 30000 | — | Retry backoff base |
| `jobs.ssePollMs` | integer | 1000 | — | SSE polling interval |
| `jobs.sseMaxMs` | integer | 25000 | — | SSE connection lifetime |
| `jobs.workerIntervalMs` | integer | 5000 | — | Local worker loop interval |
| `github.reserve.core` | integer | 200 | — | REST calls kept in reserve |
| `github.reserve.graphql` | integer | 300 | — | GraphQL points kept in reserve |
| `github.reserve.search` | integer | 2 | — | Search calls kept in reserve |
| `github.maxPages.default` | integer | 10 | — | Pagination hard cap |
| `github.maxReposPerProfile` | integer | 100 | — | Repos fetched per profile |
| `github.requestTimeoutMs` | integer | 15000 | — | Per-request timeout |
| `sources.registry.minIntervalMs` | integer | 1000 | — | Gap between calls to one registry |
| `sources.userAgent` | string | `CommitMates/1.0` | — | Prefix of the User-Agent sent to sources (contact appended from env) |
| `privacy.nonUserRawTtlHours` | integer | 24 | — | Raw non-member data lifetime |
| `privacy.aggregateSaltRotationDays` | integer | 30 | — | Anonymous dedupe salt lifetime |
| `storage.dbBudgetMb` | integer | 450 | — | Admin alert threshold; set per plan |
| `email.maxPerDay` | integer | 80 | — | Keep under the provider's free quota (verify in ADR) |
| `email.digestHourLocal` | integer | 18 | — | Local hour for daily digests |
| `profile.bioMaxChars` | integer | 280 | — | Bio length cap |

**Caching and rate limits**

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `cache.devCardTtlHours` | integer | 12 | — | F1 result lifetime |
| `cache.compatTtlHours` | integer | 12 | — | F2 result lifetime |
| `cache.recruiterTtlHours` | integer | 24 | — | F3 result lifetime |
| `cache.fairnessTtlHours` | integer | 24 | — | F4 result lifetime |
| `cache.gapTtlHours` | integer | 24 | — | F5 result lifetime |
| `cache.searchTtlHours` | integer | 6 | — | F7, F8, F9 search results |
| `cache.taxonomyTtlDays` | integer | 7 | — | F6 expansions |
| `cache.packageMetaTtlDays` | integer | 30 | — | Registry metadata |
| `cache.topicCountTtlDays` | integer | 7 | — | Topic global counts |
| `rate.tool.capacity` | integer | 10 | — | Tool bucket size per IP hash |
| `rate.tool.refillPerMin` | number | 2 | — | Tool bucket refill |
| `rate.write.capacity` | integer | 30 | — | Member write bucket size |
| `rate.write.refillPerMin` | number | 10 | — | Member write refill |

**Day-one tools**

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `persona.minEvents` | integer | 15 | — | Fewer events → "not enough activity" |
| `persona.percentile` | number | 0.8 | — | Which percentile defines a label |
| `persona.nightOwl.share` | number | 0.35 | p80 of night-share samples | Share of activity 22:00–04:00 local |
| `persona.earlyBird.share` | number | 0.30 | p80 of morning-share samples | Share of activity 05:00–09:00 local |
| `persona.weekendWarrior.share` | number | 0.40 | p80 of weekend-share samples | Share of activity on Sat/Sun |
| `persona.sprinter.cv` | number | 1.5 | p80 of daily-count CV samples | Bursty activity |
| `persona.marathoner.activeDayShare` | number | 0.5 | p80 of active-day-share samples | Steady activity |
| `companion.stageCuts` | number\[\] | \[0.25,0.5,0.75,0.9\] | quantiles of activity score | Evolution stage cuts |
| `compat.weights` | json | {"skill":0.3,"interest":0.25,"rhythm":0.2,"complement":0.25} | — | F2 component weights |
| `compat.bands` | json | \[{"min":0,"key":"different-worlds"},{"min":40,"key":"good-pair"},{"min":65,"key":"strong-pair"},{"min":85,"key":"dream-team"}\] | — | Score bands → copy keys |
| `recruiter.weights` | json | see F3 | — | Rule weights |
| `recruiter.genericMessageTopK` | integer | 50 | — | Most frequent corpus messages treated as generic |
| `recruiter.minMessageTokens` | integer | 3 | — | Shorter messages are low-information |
| `recruiter.secretScan.maxFiles` | integer | 200 | — | Files scanned per report |
| `recruiter.secretScan.maxFileBytes` | integer | 200000 | — | Max file size scanned |
| `recruiter.pinned.min` | integer | 2 | — | Pinned repos lower bound |
| `recruiter.pinned.max` | integer | 6 | — | Pinned repos upper bound |
| `recruiter.readme.minChars` | integer | 600 | p40 of README lengths of well-starred repos | README length target |
| `fairness.leastShareThreshold` | number | 0.14 | — | From published research on student teams |
| `fairness.lateWindowPct` | number | 0.15 | — | Final share of the timeline counted as "late" |
| `fairness.maxCommits` | integer | 500 | — | Commits analyzed for line-level detail |
| `fairness.statsRetryMax` | integer | 6 | — | Retries while stats return 202 |
| `gap.peerSampleSize` | integer | 30 | — | Peer repos compared |
| `gap.minPrevalence` | number | 0.5 | — | Facet share among peers that makes it "expected" |
| `gap.maxGaps` | integer | 8 | — | Gaps shown |
| `gap.minPeerStars` | integer | 10 | — | Peers must have at least this many stars |
| `taxonomy.sampleSize` | integer | 100 | — | Repos sampled per term |
| `taxonomy.maxExpansions` | integer | 15 | — | Expansion items kept |
| `taxonomy.minSampleFreq` | number | 0.05 | — | Minimum frequency in the sample |
| `taxonomy.minCorpus` | integer | 5000 | — | Repos needed before our own dependency baseline is used |
| `graveyard.idleMonths.default` | number | 6 | — | Idle threshold before category data exists |
| `graveyard.idleMonths.<category>` | number | default | p75 push gap of active repos in the category | Per-category idle threshold |
| `graveyard.minCommits` | integer | 5 | — | Minimum commit count |
| `graveyard.freshMonths` | integer | 24 | — | Idle ≤ this = fresh |
| `graveyard.noLicenseFactor` | number | 0.3 | — | Penalty multiplier without a license |
| `graveyard.deepScoreTopN` | integer | 50 | — | Candidates that get expensive inputs |
| `graveyard.weights` | json | {"promise":0.35,"demand":0.25,"unfinished":0.25,"freshness":0.15} | — | Revivability weights |
| `graveyard.unfinishedTerms` | string\[\] | \["todo","wip","work in progress","coming soon","not finished","incomplete","under development","in progress"\] | — | Seed vocabulary |
| `oss.beginnerLabelTerms` | string\[\] | \["good first issue","good-first-issue","beginner","first-timers","first timers","easy","starter","newcomer"\] | — | Seed vocabulary |
| `oss.maxRepoIdleDays` | integer | 60 | — | Repo must be pushed within this |
| `oss.maxResponseHours` | number | 168 | p60 of observed maintainer response times | Responsiveness gate |
| `oss.maxComments` | integer | 3 | — | Issues with more comments are skipped |
| `oss.responsivenessSample` | integer | 20 | — | Issues sampled for responsiveness |
| `fyp.minCorpus` | integer | 30 | — | Uni FYP corpus size before uni search runs first |
| `fyp.searchTopN` | integer | 20 | — | READMEs reranked |
| `fyp.yake.maxKeyphrases` | integer | 10 | — | Keyphrases extracted |
| `fyp.yake.ngramMax` | integer | 3 | — | Longest keyphrase in words |

**Foundation and campus**

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `verify.otpTtlMinutes` | integer | 10 | — | OTP lifetime |
| `verify.maxAttempts` | integer | 5 | — | Wrong guesses allowed per code |
| `verify.maxSendsPerDay` | integer | 5 | — | Codes sent per user per day |
| `verify.vouchesRequired` | integer | 2 | — | Vouches needed without a uni email |
| `unlock.matching.minMembers` | integer | 10 | — | F11 unlock |
| `unlock.reviews.minMembers` | integer | 10 | — | F15 unlock |
| `unlock.swap.minMembers` | integer | 10 | — | F16 unlock |
| `unlock.legacy.minProjects` | integer | 5 | — | F17 unlock |
| `unlock.gapCampus.minMembers` | integer | 10 | — | F5 campus layer unlock |
| `unlock.leaderboard.minMembers` | integer | 15 | — | F19 unlock |
| `unlock.alumni.minAlumni` | integer | 5 | — | F20 unlock |
| `unlock.squads.minParticipants` | integer | 6 | — | F21 unlock per event |
| `unlock.fypBoard.minMembers` | integer | 10 | — | F22 unlock |
| `matching.starCap` | integer | 200 | — | Starred repos considered |
| `matching.deckSize` | integer | 15 | — | Suggestions per day |
| `matching.maxDailyImpressions` | integer | 20 | — | Times one person may be shown per day |
| `matching.successMessages` | integer | 4 | — | Messages from both sides that mark a match successful |
| `matching.weightStep` | number | 0.05 | — | Max nightly weight change |
| `matching.weights` | json | {"study":{"sim":0.6,"int":0.3,"comp":0.1},"teammate":{"sim":0.2,"int":0.2,"comp":0.6},"explore":{"sim":0.34,"int":0.33,"comp":0.33}} | tuned nightly (F11) | Mode weights |
| `chat.newThreadsPerDay.base` | integer | 3 | — | Base daily new-request limit |
| `chat.minFirstMessageChars` | integer | 40 | — | First-message minimum without an icebreaker |
| `chat.newAccountDays` | integer | 7 | — | "New account" window |
| `chat.maxLinksNewAccount` | integer | 1 | — | Links per message for new accounts |
| `chat.maxMessageChars` | integer | 4000 | — | Message length cap |
| `trust.weights` | json | {"age":0.25,"verified":0.25,"acceptRate":0.3,"reports":-0.2} | — | Trust components |
| `trust.multiplierRange` | number\[\] | \[0.5,3\] | — | Min and max trust multiplier |
| `safety.autoHideReports` | integer | 3 | — | Distinct verified reporters that auto-hide an account |
| `safety.reportWindowDays` | integer | 30 | — | Window for counting reports |
| `streaks.minDailyContributions` | integer | 1 | — | Contributions needed per person per day |
| `streaks.graceHours` | integer | 6 | — | Hours after local midnight before a day is judged |
| `streaks.freezeEveryDays` | integer | 7 | — | Streak days per earned freeze |
| `streaks.maxFreezes` | integer | 2 | — | Freezes held at once |
| `streaks.pauseAfterMissedDays` | integer | 3 | — | Consecutive misses before pausing |
| `streaks.companionStageDays` | number\[\] | \[3,7,14,30,60\] | quantiles of ended-streak lengths | Pair companion stages |
| `adoptions.reviveMinCommits` | integer | 3 | — | Commits on the fork after adoption that count as revived |
| `reviews.starterCredits` | integer | 1 | — | Credits given to new members |
| `reviews.minLineComments` | integer | 3 | — | Line comments a review needs |
| `reviews.claimTtlHours` | integer | 72 | — | Time a reviewer has after claiming |
| `reviews.requestTtlDays` | integer | 14 | — | Open request lifetime |
| `swap.maxCycleLength` | integer | 3 | — | Longest swap cycle |
| `swap.minTeachLevel` | number | 0.5 | — | Minimum verified level (percentile) to offer a tag |
| `legacy.minGradYearsAgo` | integer | 0 | — | Seniors: grad year ≤ current year + this |

**Crowd**

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `crawler.searchCap` | integer | 1000 | — | GitHub search result ceiling per query |
| `crawler.maxUsers` | integer | 50000 | — | Storage guard |
| `crawler.maxRepos` | integer | 200000 | — | Storage guard |
| `crawler.reposPerUser` | integer | 30 | — | Repos indexed per crawled user |
| `geocoder.minIntervalMs` | integer | 1100 | — | Above the policy's one-per-second limit |
| `geocoder.nonPlaceTerms` | string\[\] | \["earth","internet","remote","worldwide","localhost","home"\] | — | Strings never sent to the geocoder |
| `leaderboard.minActiveDays` | integer | 3 | — | Active days in the week that make a member "active" |
| `alumni.routeTopK` | integer | 3 | — | Alumni per routing round |
| `alumni.slaHours` | integer | 48 | — | Hours before re-routing |
| `alumni.maxOpenPerAlumnus` | integer | 3 | — | Open questions per alumnus |
| `alumni.maxRounds` | integer | 3 | — | Routing rounds before the question expires |
| `squads.kMax` | integer | 6 | — | Max clusters tried |
| `squads.defaultTeamSize` | integer | 4 | — | Default team size |

**Added during implementation**

Keys that §8 names as "new key" (or that a formula needs), seeded in `0003_settings_seed.sql` with the rest.

| Key | Type | Default | Computed | Meaning |
| --- | --- | --- | --- | --- |
| `persona.manifestRepos` | integer | 10 | — | Most recently pushed repos whose manifests are read (F1) |
| `companion.activityRef` | integer | 1000 | — | Yearly contributions that map to activity score 1 before samples exist (F1) |
| `recruiter.profileReadme.minChars` | integer | 200 | — | Profile README length that earns credit (F3) |
| `ir.bm25.k1` | number | 1.2 | — | BM25 term-frequency saturation (F9) |
| `ir.bm25.b` | number | 0.75 | — | BM25 length normalization (F9) |
| `fyp.bands` | number\[\] | \[40,70\] | — | Similarity cut-offs: related and very similar (F9) |
| `fyp.detectTerms` | string\[\] | \["final year project","fyp"\] | — | Seed vocabulary that marks a README as a final-year project (F22) |
| `verify.voucherMinDays` | integer | 7 | — | Days a member must be verified before vouching (F10) |
| `matching.tuneMinSuccesses` | integer | 30 | — | Successful matches needed before weights are tuned (F11) |
| `chat.requestTtlDays` | integer | 14 | — | Days before an unanswered message request expires (F12) |
| `chat.editWindowMinutes` | integer | 10 | — | Minutes a message stays editable (F12) |
| `streaks.maxActivePairs` | integer | 3 | — | Active pairs one member may have (F13) |
| `adoptions.dropAfterDays` | integer | 90 | — | Days without commits before an adoption is dropped (F14) |
| `reviews.autoSettleDays` | integer | 7 | — | Days without a rating before a review settles as helpful (F15) |
| `crawler.minCitySeedMembers` | integer | 2 | — | Members in a city before it seeds the crawler (F18) |
| `crawler.refreshDays` | integer | 30 | — | Days between re-crawls of a cursor (F18) |
| `leaderboard.minDeptMembers` | integer | 5 | — | Verified members a department needs to be ranked (F19) |
| `leaderboard.weights` | json | {"activeRatio":0.5,"medianActiveDays":0.3,"revivals":0.1,"helpfulReviews":0.1} | — | University score weights (F19) |
| `alumni.transitionMonth` | integer | 7 | — | Month after which last year's graduates become alumni (F20) |
| `squads.minOverlapHours` | integer | 4 | — | Weekly availability overlap a team needs (F21) |

`min_sample` for computed keys is seeded as 200 for sample percentiles, 30 for `matching.weights` and `streaks.companionStageDays`. `graveyard.idleMonths.<category>` rows are created by the recompute job per category and are not part of the static key registry.

### 5.6 GitHub client (`packages/github`)

**Token identities.** Exactly two kinds:

```ts
type TokenIdentity =
  | { kind: 'user'; userId: string }   // a member's OAuth token, decrypted server-side per call
  | { kind: 'server' };                // GITHUB_SERVER_TOKEN: anonymous tools and source syncs
```

- A member's own analyses use their own identity, so they spend their own budget.
- Anonymous tools and syncs use `server`.
- Never choose an identity to dodge limits, and never add extra tokens.

**Conditional-request cache.**

```sql
create table api_cache (
  token_identity text not null,        -- 'server' or 'user:<uuid>'
  method text not null,
  url text not null,
  etag text,
  last_modified text,
  status smallint not null,
  body jsonb,
  fetched_at timestamptz not null,
  expires_at timestamptz,
  primary key (token_identity, method, url)
);
```

- Every REST GET sends `If-None-Match` and `If-Modified-Since` when a cached row exists.
- On 304, return the cached body. A correctly authorized 304 does not count against the primary rate limit.
- ETags are tied to the token, so the cache key includes the identity.
- GraphQL has no conditional requests; cache GraphQL results in `analysis_cache` instead.

**Budgets.**

```sql
create table github_budgets (
  token_identity text not null,
  resource text not null,              -- value of x-ratelimit-resource: core, search, graphql, …
  "limit" integer,
  remaining integer,
  reset_at timestamptz,
  last_call_at timestamptz,
  updated_at timestamptz not null,
  primary key (token_identity, resource)
);
```

- Updated from `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` and `x-ratelimit-resource` on every response, and from GraphQL `rateLimit { limit cost remaining resetAt }`.
- `ensureBudget(identity, resource, cost)` throws `RateLimitError(resetAt)` when `remaining − cost < github.reserve.<resource>`.
- Limits are read, never assumed. Before the first call for an identity, call `GET /rate_limit` (it does not consume the core limit) to initialize the rows.

**Search pacer.** Search has its own stricter limit. Before each search call, lock the identity's `search` row (`select … for update`), compute the minimum gap as `ceil(60000 / limit) + jitter(0–250ms)` where `limit` is the current search limit per minute, wait if `last_call_at` is too recent (or return `wait` to the job if the wait exceeds the remaining budget), then update `last_call_at`.

**Secondary limits.** On 403 or 429 with `retry-after`, reschedule for that many seconds. Without the header, back off exponentially from 60 seconds. Log `x-github-request-id`.

**202 handling.** `/stats/*` endpoints may return 202 while GitHub computes. Retry up to `fairness.statsRetryMax` times with increasing delays inside the deadline. If still 202, return `{ kind: 'wait' }` so the runner reschedules.

**GraphQL.**

- Queries live in `packages/github/src/queries/*.ts` as typed template strings, with zod schemas for their results.
- Every query also selects `rateLimit { limit cost remaining resetAt }`.
- `first:` sizes come from settings; pagination uses `pageInfo { hasNextPage endCursor }` with page caps from `github.maxPages.default`.

**Errors.**

| Class | Cause | Runner behavior |
| --- | --- | --- |
| `GitHubNotFoundError` | 404 | Not retried; friendly message |
| `GitHubAuthError` | 401; for user tokens, also sets `github_identities.token_invalid = true` and prompts re-auth | Not retried |
| `RateLimitError` | Budget below reserve or limit hit; carries `resetAt` | Waits; no attempt consumed |
| `GitHubServerError` | 5xx, network errors, timeouts | Retried with backoff |
| `GitHubValidationError` | 422 (e.g. invalid search query) | Not retried |

**Validation.** Every response is parsed with a zod schema that covers only the fields we use; unknown fields are stripped.

**Helpers.** `parseGitHubUrl(input)` accepts `https://github.com/o/r`, `/tree/…`, `/pull/<n>`, a `.git` suffix and `o/r` shorthand, and returns `{ owner, repo, number? }` or `null`. Nothing else is ever fetched from a user-supplied URL.

### 5.7 Source module contract (`packages/sources/<name>`)

```ts
export interface SourceModule<Raw, Normalized> {
  name: string;                                              // 'hipo' | 'linguist' | …
  fetchRaw(ctx: SourceContext): Promise<{ raw: Raw; version: string }>; // version = etag, sha or checksum
  normalize(raw: Raw): Normalized[];                          // pure; unit-tested with fixtures
  sync(items: Normalized[], db: Db): Promise<{ inserted: number; updated: number; deleted: number; skipped: number }>;
}
```

- Syncs are diff-based: compare checksums with existing rows and skip unchanged ones.
- Record `{source, version, checksum, item_count, skipped_count, fetched_at}` in `source_snapshots`.
- If `fetchRaw` fails or returns something unparseable, keep the last good data and record `last_error`. Never wipe data because a source is down.

### 5.8 Caching layers

| Layer | Table | Key | Lifetime |
| --- | --- | --- | --- |
| HTTP (REST) | `api_cache` | identity + method + URL | ETag; optional `expires_at` |
| Computed results | `analysis_cache` | kind + subject + params hash | `cache.*Ttl*` settings |
| Package metadata | `package_meta` | ecosystem + name | `cache.packageMetaTtlDays` |
| Topic counts | `topic_global_counts` | slug | `cache.topicCountTtlDays` |
| Taxonomy | `taxonomy_expansions` | normalized term | `cache.taxonomyTtlDays` |
| Geocoding | `geocode_cache` | normalized query | Forever |
| Source snapshots | `source_snapshots` | source | Until next weekly sync |
| Settings | Memory | key | `settings.cacheMs` |

### 5.9 Realtime and Row Level Security

**Principles.**

- RLS is enabled on every table, in the same migration that creates it.
- Tables the browser never reads directly get no policies (deny-all for `anon` and `authenticated`). All server access uses Drizzle with the service connection.
- Only these tables are readable by the browser through Supabase Realtime: `messages`, `thread_members` (own rows), `notifications` (own rows).
- All writes happen through Server Actions after rate-limit, block and permission checks. No insert or update policies for `authenticated`.

**Policies.**

```sql
alter table messages enable row level security;
create policy messages_select on messages for select to authenticated
  using (exists (
    select 1 from thread_members tm
    where tm.thread_id = messages.thread_id and tm.user_id = auth.uid()
  ));

alter table thread_members enable row level security;
create policy thread_members_select on thread_members for select to authenticated
  using (user_id = auth.uid());

alter table notifications enable row level security;
create policy notifications_select on notifications for select to authenticated
  using (user_id = auth.uid());
```

RLS integration tests sign in as two users and assert that cross-access returns nothing.

### 5.10 Security

**Threat model.**

| Threat | Mitigation |
| --- | --- |
| Token theft from the database | AES-256-GCM encryption with a versioned key from env; decryption only in server code |
| OTP brute force | Hashed OTP + pepper, short TTL, attempt cap, send cap, per-IP bucket |
| Scraping our tools to burn GitHub budget | Per-IP-hash and per-user buckets, cached results, reserve budgets |
| XSS through README or markdown | rehype-sanitize with a strict schema, no raw HTML, CSP with nonces |
| CSRF | Server Actions' origin checks; route handlers verify `Origin` on POST |
| Chat spam and harassment | Message requests, trust-based limits, link caps, blocks, reports, auto-hide |
| Fake university claims | Suffix match against the synced list, disposable-domain block, vouching, admin approval for unknown domains |
| Secrets leaked in our own repo | gitleaks in CI, `.env*` ignored, secrets in Supabase Vault instead of SQL |
| Privilege escalation | Roles checked server-side on every admin action; deny-by-default RLS |
| SSRF through user URLs | Only GitHub URLs, parsed into owner/repo/number; arbitrary URLs are never fetched |
| Abuse of non-member data | No public pages or rankings for non-members, TTL purge, owner-only secret findings |
| Credit-ledger manipulation | Append-only ledger, transactional balance checks with row locks, admin-only adjustments with audit |

**Token encryption** (`packages/db/src/crypto.ts`).

```ts
// Format: v<keyVersion>.<ivB64>.<tagB64>.<cipherB64>
export function encrypt(plain: string): string;  // aes-256-gcm, random 12-byte IV
export function decrypt(token: string): string;  // picks the key by version: current or PREV
```

Rotation (`docs/runbooks/rotate-token-key.md`): set the new key as current and the old one as `TOKEN_ENCRYPTION_KEY_PREV`, run `reencrypt_tokens`, then remove `_PREV`.

**OTP.** Code = `crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits. Stored as `sha256(code + OTP_PEPPER)`. Compared with `crypto.timingSafeEqual`.

**Rate limiting** (token bucket in Postgres).

```sql
create table rate_limit_buckets (
  key text primary key,
  tokens double precision not null,
  updated_at timestamptz not null
);

create or replace function take_token(
  p_key text, p_capacity double precision, p_refill_per_sec double precision, p_cost double precision default 1)
returns boolean language plpgsql as $$
declare v_tokens double precision; v_now timestamptz := clock_timestamp();
begin
  insert into rate_limit_buckets(key, tokens, updated_at) values (p_key, p_capacity, v_now)
  on conflict (key) do update set
    tokens = least(p_capacity,
      rate_limit_buckets.tokens + extract(epoch from (v_now - rate_limit_buckets.updated_at)) * p_refill_per_sec),
    updated_at = v_now
  returning tokens into v_tokens;
  if v_tokens >= p_cost then
    update rate_limit_buckets set tokens = tokens - p_cost where key = p_key;
    return true;
  end if;
  return false;
end $$;
```

`guardRate(key, settingsPrefix)` in `apps/web/src/server/rate.ts` reads `<prefix>.capacity` and `<prefix>.refillPerMin`, calls `take_token`, and throws `RateLimitedError` with a retry hint. `cleanup_rate_buckets` deletes rows untouched for a day.

**HTTP headers** (`next.config.ts`).

- `Content-Security-Policy`: `default-src 'self'`; `img-src 'self' https://avatars.githubusercontent.com data:`; `connect-src 'self'` plus the Supabase URL and its `wss://` host; `frame-ancestors 'none'`; nonces for any inline script.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that disables camera, microphone and geolocation.

### 5.11 Authorization

- **Roles:** `admin` (global) and `uni_moderator` (scoped to one university), stored in `roles`.
- **Bootstrap:** `BOOTSTRAP_ADMIN_GITHUB_ID` grants `admin` on that account's first sign-in, written to `audit_log`.
- **Server guards** (`apps/web/src/server/guards.ts`): `requireUser()`, `requireVerified()`, `requireRole('admin')`, `requireRole({ role: 'uni_moderator', universityId })`. Every Server Action and admin route calls one first.
- **Route groups:** `(app)/*` requires a verified member (middleware redirects to onboarding otherwise); `(admin)/*` requires a role; `(tools)/*` and `(marketing)/*` are public.
- **Moderators** can approve departments, supervisors and pending university domains for their own university, and review reports involving its members.

### 5.12 Privacy model

| Class | Examples | Retention | Deletion |
| --- | --- | --- | --- |
| A: member personal | Emails, profile, messages, ledger, listings | Until account deletion | Hard delete with cascades |
| B: member derived | Skill vectors, persona snapshots, reports | Recomputed; deleted with the account | Cascade |
| C: non-member public cache | `gh_users`, `gh_repos`, `analysis_cache` rows about non-members | `privacy.nonUserRawTtlHours` | `purge_non_user_raw` |
| D: anonymous aggregates | `metric_samples` | Kept | Not linkable to anyone |
| E: country index | Minimal public user and repo metadata for search | Refreshed; removed when GitHub returns 404 | Opt-out form by GitHub login (`crawl_optouts`) |

**Anonymous aggregate dedupe.** One person analyzed many times must not skew percentiles. Each sample stores `subject_hash = sha256(github_id + current_salt)`, unique on `(metric_key, subject_hash, salt_period)`. `rotate_salts` creates a new salt every `privacy.aggregateSaltRotationDays` and deletes old ones, so hashes cannot be linked back.

**Account deletion** (`DELETE` via Server Action on `/settings/privacy`, with typed confirmation):

1. Revoke the OAuth grant through the GitHub API (best effort).
2. In one transaction, delete the member's rows in every class A and B table. In threads with other members, replace their messages with one system message ("A member left this conversation").
3. End active pairs, withdraw listings, refund open review escrows, cancel open questions.
4. Delete the Supabase auth user.
5. Write `audit_log` with only a hashed user id.

**Export.** `GET /api/me/export` returns one JSON file with every class A and B row for the member, grouped by table.

### 5.13 Observability

- **Logs:** pino JSON with `level`, `time`, `msg`, `reqId` or `jobId`, hashed `userId`, `route` or `jobType`, `durationMs`, `ghRequestId`. Never log tokens, emails, OTPs, message bodies or IP addresses.
- **`/admin/health`:** queue depth by status and type, oldest queued job per priority, dead jobs (24h); GitHub budgets per identity and resource; source snapshot ages and last errors; database size vs `storage.dbBudgetMb`; emails sent today vs `email.maxPerDay`; settings whose `computed_at` is older than 3 days.
- **Alerts** (red banner for admins, plus a daily email when any is active): dead jobs in the last 24h; an interactive job queued more than 2 minutes; database above 90% of budget; a source snapshot older than 14 days; email sends above 90% of the daily cap.
- **Sentry:** optional, initialized only when `SENTRY_DSN` is set; `beforeSend` strips PII.

### 5.14 Error-to-UX mapping

| Situation | Companion state | Copy pattern |
| --- | --- | --- |
| Job queued or running | Working | "Reading 42 repos… (step 2 of 4)" |
| Waiting on a rate limit | Waiting | "GitHub asked us to slow down — back in about 3 min. You can leave; we'll keep going." |
| User not found | Error | "We couldn't find @name on GitHub. Check the spelling?" |
| Organization account | Error | "That's an organization. Dev Cards are for people." |
| Not enough data | Idle | "Not much public activity in the last 90 days. Sign in to include private contribution counts." |
| Unexpected failure | Error | "Something broke on our side. We've logged it (ref: abc123)." |
| Feature locked | Idle | Unlock card (§1.4) |
| Form validation error | — | Inline message next to the field, from the action result |

## 6. Live data sources

Every list the app uses comes from one of these sources, synced into Postgres. Each has a module in `packages/sources/<name>` (or `packages/github`) and an entry in `docs/DATA_SOURCES.md`.

### 6.1 GitHub REST and GraphQL

- **Used for:** users, repos, languages, topics, file contents, commits, contributor stats, issues, labels, pull requests, reviews, events, search.
- **Access:** the identities and rules in §5.6.
- **Refresh:** on demand, through the caches in §5.8.
- **Known behaviors to design around:**
  - User events cover only a recent window (90 days, at most 300 events). The UI must say "last 90 days".
  - Search returns at most `crawler.searchCap` results per query, so the crawler partitions queries (F18).
  - `/stats/contributors` excludes merge commits and empty commits, and may return 202 while computing.
  - Private contribution counts appear in `contributionsCollection` only if the user enabled them and granted `read:user`.
- **Issue creation without write scope:** links to `https://github.com/<o>/<r>/issues/new?title=…&body=…` (URL-encoded) open a prefilled issue in the user's browser. Used for adoption requests (F7).

### 6.2 `github/explore` repository

- **Used for:** topic aliases and related topics (F6).
- **Fetch:** the default branch's git tree through the GitHub API in one call, then only the `topics/<slug>/index.md` blobs whose SHA changed since the last sync.
- **Parse:** YAML front matter → `{ topic, display_name, aliases, related }`. `aliases` and `related` are comma-separated strings: split on commas and trim.
- **Stored in:** `topics`.
- **Refresh:** weekly (`sync_explore`).
- **Attribution:** on `/attribution`.

### 6.3 GitHub Linguist

- **Used for:** language colors (companion palettes, charts), file extension → language (F15 reviewer matching), vendored and documentation path patterns (F4 line exclusion).
- **Files:** `lib/linguist/languages.yml`, `lib/linguist/vendor.yml`, `lib/linguist/documentation.yml`. Generated-file detection lives in Linguist's code; mirror only path-pattern rules and note that in `DATA_SOURCES.md`.
- **Stored in:** `languages`, `path_patterns`.
- **Regex note:** the patterns are Ruby regexes. Compile them with the RE2 engine. Skip and log any that fail; record the skipped count in `source_snapshots`.
- **Refresh:** weekly (`sync_linguist`).

### 6.4 Hipo university-domains-list

- **Used for:** universities, their root email domains, countries, two-letter codes, state or province, websites (F10).
- **Fetch:** the raw JSON file from the repository's default branch, with a conditional request.
- **Normalize:**
  - lowercase and dedupe domains;
  - `slug = kebab(name) + "-" + lowercase(alpha_two_code)`, with `-2`, `-3` on collision;
  - checksum per university to skip unchanged rows.
- **Sync:** diff upsert into `universities` and `university_domains`. Never delete a university with members; set `source_missing = true` instead.
- **Matching rule:** the list stores root domains only. `name@cs.uni.edu` must match `uni.edu`: walk the email domain's labels from the left and take the longest registered suffix at a label boundary.
- **Refresh:** weekly (`sync_hipo`).

### 6.5 Disposable email domains

- **Used for:** rejecting throwaway addresses during verification (F10).
- **Source:** a well-maintained open-source blocklist repository, chosen in P3-T01, license recorded in an ADR.
- **Stored in:** `disposable_domains`.
- **Refresh:** weekly (`sync_disposable_emails`).

### 6.6 Package registries

| Ecosystem | Manifest files | Endpoint | Fields used |
| --- | --- | --- | --- |
| npm | `package.json` | `https://registry.npmjs.org/<name>` | `keywords`, `repository.url`, `description` |
| PyPI | `requirements*.txt`, `pyproject.toml`, `Pipfile`, `setup.cfg` | `https://pypi.org/pypi/<name>/json` | `info.keywords`, `info.classifiers`, `info.project_urls` |
| crates.io | `Cargo.toml` | `https://crates.io/api/v1/crates/<name>` | `crate.keywords`, `crate.categories`, `crate.repository` |
| pub.dev | `pubspec.yaml` | `https://pub.dev/api/packages/<name>` | `latest.pubspec.topics`, `latest.pubspec.repository` |
| Packagist | `composer.json` | `https://repo.packagist.org/p2/<vendor>/<name>.json` | `keywords`, `source.url` |
| Go, Maven, Gradle, RubyGems, others | `go.mod`, `pom.xml`, `build.gradle(.kts)`, `Gemfile` | No registry call | Fallback below |
| Fallback (any) | — | The package's GitHub repo, from metadata or module path | Repo `topics` |

- **Derived tags** (`package_meta.derived_tags`): the normalized union of keywords, the leaf of each `Topic ::` classifier (e.g. `Topic :: Scientific/Engineering :: Image Recognition` → `image-recognition`), categories, and GitHub topics.
- **Normalization:** lowercase, spaces and underscores → hyphens, then map through topic aliases from §6.2 so `reactjs` and `react` become one tag.
- **No vocabulary is hand-written.** The tag set is whatever emerges from these sources.
- **Pacing:** one request in flight per registry, `sources.registry.minIntervalMs` between calls, identifying User-Agent (`sources.userAgent` + contact from env). Some registries (crates.io) require it.
- **Refresh:** on demand with TTL `cache.packageMetaTtlDays` (`enrich_packages`).

### 6.7 gitleaks default rules

- **Used for:** secret detection in the Recruiter-Ready Score (F3).
- **Fetch:** `config/gitleaks.toml` from the gitleaks repository's default branch.
- **Parse:** with `smol-toml` → `{ id, description, regex, keywords, entropy, allowlists }`.
- **Compile:** with the RE2 engine. Skip and log rules that fail; record the count.
- **Scan order:** case-insensitive keyword prefilter → regex → entropy check when the rule has one → global allowlist paths.
- **Stored in:** `secret_rules`.
- **Refresh:** weekly (`sync_gitleaks`).

### 6.8 Nominatim (OpenStreetMap)

- **Used for:** turning a free-text location into `{ lat, lon, city, country_code }` (F1 timezone, F18 crawler seeds).
- **Endpoint:** `GEOCODER_BASE_URL` + `/search?format=jsonv2&addressdetails=1&limit=1&q=<query>`.
- **Policy:**
  - app-wide minimum interval `geocoder.minIntervalMs`, enforced by locking the single `geocoder_lock` row;
  - `User-Agent: GEOCODER_USER_AGENT`;
  - no bulk jobs beyond the paced queue, no autocomplete;
  - results cached forever in `geocode_cache`;
  - "© OpenStreetMap contributors" shown wherever a geocoded result is displayed;
  - endpoint switchable through env without a code change.
- **Normalization before lookup:** trim, collapse whitespace, lowercase, strip emoji and URLs. Strings that match `geocoder.nonPlaceTerms` or are empty are stored as `unresolvable` without a call.
- **Queue:** lookups are inserted as `pending` rows; `geocode_pending` resolves them one at a time.

### 6.9 Coordinates → timezone

An offline library maps `(lat, lon)` to an IANA timezone. The result is stored on the `geocode_cache` row.

### 6.10 Browser timezone

`Intl.DateTimeFormat().resolvedOptions().timeZone` is captured during onboarding and editable in settings. It is the timezone used for every member-facing "day".

### 6.11 Attribution page

`/attribution` lists, generated from `source_snapshots` and the dependency license report: OpenStreetMap/Nominatim, Hipo university-domains-list, GitHub Linguist, github/explore, gitleaks, the disposable-domain list, fonts (OFL), icons (Apache-2.0), and every runtime dependency with its license.

## 7. Data model

The schema is split into nine groups. This section is the contract; the exact definitions live in `packages/db/src/schema/<group>.ts`.

**Conventions.**

- Primary keys: `uuid default gen_random_uuid()`, except natural keys (GitHub ids, slugs, composite keys).
- Every table has `created_at timestamptz not null default now()`; mutable tables also have `updated_at` (set by a trigger).
- `citext` for logins, emails and domains. Postgres enums for closed sets.
- Every foreign key is indexed. Every column used in a hot-path `where` or `order by` is indexed.
- RLS is enabled on every table in the migration that creates it (§5.9).
- User data is hard-deleted on request. No soft delete except where a column says so.
- Tables already defined in §5 (`jobs`, `job_schedules`, `settings`, `settings_history`, `api_cache`, `github_budgets`, `rate_limit_buckets`) are not repeated here.

### 7.1 Identity

| Table | Columns |
| --- | --- |
| `users` | `id uuid pk` (= `auth.users.id`, on delete cascade), `status enum(active, suspended, hidden_pending_review)`, `last_seen_at` |
| `github_identities` | `user_id pk fk`, `github_id bigint unique`, `login citext unique`, `name`, `avatar_url`, `token_enc text`, `token_key_version smallint`, `token_invalid boolean default false`, `scopes text[]`, `private_contrib_visible boolean` |
| `profiles` | `user_id pk fk`, `university_id fk null`, `role enum(student, alumni, supervisor_pending, supervisor)`, `grad_year smallint null`, `department_id fk null`, `timezone text not null`, `visibility enum(university, country, public, hidden)`, `ghost_mode boolean`, `learning_goals text[]`, `bio text`, `onboarded_at`, `verified_at`, `verified_via enum(email, vouch, admin) null` |
| `roles` | `user_id fk`, `role enum(admin, uni_moderator)`, `university_id fk null`, `granted_by`, `granted_at`; unique on `(user_id, role, coalesce(university_id, '00000000-0000-0000-0000-000000000000'))` |

### 7.2 Universities and verification

| Table | Columns |
| --- | --- |
| `universities` | `id`, `name`, `slug unique`, `country`, `country_code char(2)`, `state_province`, `web_pages text[]`, `source enum(hipo, admin)`, `source_missing boolean`, `checksum`, `member_count int` (trigger-maintained) |
| `university_domains` | `domain citext pk`, `university_id fk` |
| `university_requests` | `id`, `user_id`, `domain`, `proposed_name`, `country_code`, `status enum(pending, approved, rejected)`, `reviewed_by`, `reviewed_at`, `note` |
| `disposable_domains` | `domain citext pk`, `synced_at` |
| `email_verifications` | `id`, `user_id`, `email citext`, `domain`, `university_id null`, `code_hash`, `expires_at`, `attempts smallint`, `sends_today smallint`, `last_sent_at`, `verified_at`; partial unique index on `user_id` where `verified_at is null` |
| `vouches` | `id`, `voucher_user_id`, `vouchee_user_id`, `university_id`, `created_at`; unique on `(voucher_user_id, vouchee_user_id)`; check `voucher_user_id <> vouchee_user_id` |
| `departments` | `id`, `university_id`, `name`, `normalized_name`, `created_by`, `merged_into_id null`; GIN trigram index on `normalized_name` |
| `invites` | `code pk`, `university_id`, `created_by`, `uses int`, `created_at` |

### 7.3 GitHub data

| Table | Columns |
| --- | --- |
| `gh_users` | `github_id pk`, `login citext`, `type enum(User, Organization, Bot)`, `name`, `location_raw`, `geocode_key null`, `company`, `blog`, `bio`, `followers`, `following`, `public_repos`, `gh_created_at`, `is_member boolean`, `in_country_index boolean`, `fetched_at`, `expires_at null`; indexes on `login`, `expires_at` |
| `gh_repos` | `github_id pk`, `owner_github_id`, `full_name citext unique`, `name`, `description`, `homepage`, `topics text[]`, `primary_language`, `languages jsonb` ({language: bytes}), `stars`, `forks`, `open_issues`, `license_spdx`, `is_fork`, `is_archived`, `has_readme`, `readme_chars int`, `readme_headings text[]`, `unfinished_score real null`, `default_branch`, `size_kb`, `commit_count_est int null`, `release_count int null`, `gh_created_at`, `pushed_at`, `fetched_at`, `expires_at null`, `search_tsv tsvector` (generated from name, description, topics, readme headings); GIN on `search_tsv`; trigram on `full_name`; index on `pushed_at` |
| `repo_manifests` | `repo_github_id`, `path`, `ecosystem`, `blob_sha`, `fetched_at`; pk `(repo_github_id, path)` |
| `repo_dependencies` | `repo_github_id`, `ecosystem`, `package_name`, `is_dev boolean`; pk `(repo_github_id, ecosystem, package_name)`; index on `(ecosystem, package_name)` |
| `repo_paths` | `repo_github_id`, `path_feature`, pk `(repo_github_id, path_feature)` — normalized top-level structure features used by F5 (e.g. `dir:tests`, `file:Dockerfile`, `dir:.github/workflows`) |
| `package_meta` | `ecosystem`, `name`, `keywords text[]`, `classifiers text[]`, `repo_full_name null`, `gh_topics text[]`, `derived_tags text[]`, `fetched_at`, `expires_at`; pk `(ecosystem, name)` |
| `languages` | `name pk`, `color`, `extensions text[]`, `aliases text[]`, `synced_at` |
| `path_patterns` | `id`, `kind enum(vendored, documentation)`, `pattern`, `compiled_ok boolean`, `synced_at` |
| `secret_rules` | `id pk` (gitleaks rule id), `description`, `regex`, `keywords text[]`, `entropy real null`, `compiled_ok boolean`, `synced_at` |
| `topics` | `slug pk`, `display_name`, `aliases text[]`, `related text[]`, `synced_at` |
| `topic_global_counts` | `slug pk`, `total_count int`, `fetched_at` |
| `taxonomy_expansions` | `term pk`, `items jsonb` (\[{kind: topic or dependency or path, value, score}\]), `sample_size`, `computed_at`, `expires_at` |

### 7.4 Analysis

| Table | Columns |
| --- | --- |
| `analysis_cache` | `kind`, `subject_key`, `params_hash`, `result jsonb`, `is_member_subject boolean`, `computed_at`, `expires_at`; pk `(kind, subject_key, params_hash)`; index on `expires_at` |
| `skill_vectors` | `user_id pk`, `vector jsonb` ({tag: weight}), `top_tags text[]`, `cluster_label null`, `computed_at` |
| `persona_snapshots` | `id`, `user_id`, `window_start`, `window_end`, `metrics jsonb`, `labels text[]`, `companion jsonb`, `computed_at` |
| `recruiter_reports` | `id`, `subject_github_id`, `score smallint`, `rules jsonb`, `secret_findings jsonb` (only {rule\_id, repo, path, line} — never the secret), `computed_at` |
| `fairness_reports` | `id`, `repo_github_id`, `params jsonb`, `result jsonb`, `computed_at` |
| `gap_reports` | `id`, `repo_github_id`, `peer_repo_ids bigint[]`, `facets jsonb`, `gaps jsonb`, `computed_at` |
| `metric_samples` | `id`, `metric_key`, `value double precision`, `subject_hash`, `salt_period int`, `recorded_on date`; unique `(metric_key, subject_hash, salt_period)`; index `(metric_key, recorded_on)` |
| `salts` | `kind enum(ip, aggregate)`, `period int`, `salt bytea`, `created_at`; pk `(kind, period)` |

### 7.5 Platform

| Table | Columns |
| --- | --- |
| `geocode_cache` | `query_norm pk`, `status enum(pending, resolved, unresolvable)`, `lat`, `lon`, `city`, `country_code`, `timezone`, `confidence real`, `provider`, `fetched_at` |
| `geocoder_lock` | single row: `id smallint pk check (id = 1)`, `last_call_at` |
| `source_snapshots` | `source pk`, `version`, `checksum`, `item_count`, `skipped_count`, `fetched_at`, `last_error` |
| `audit_log` | `id bigserial`, `actor_user_id null`, `action`, `target_type`, `target_id`, `data jsonb`, `created_at`; index `(target_type, target_id)` |
| `notifications` | `id`, `user_id`, `kind`, `data jsonb`, `read_at`, `emailed_at`; index `(user_id, read_at)` |
| `notification_prefs` | `user_id pk`, `email_digest boolean`, `kinds_muted text[]` |
| `feedback` | `id`, `user_id null`, `page`, `body`, `created_at` |
| `tool_sessions` | `id`, `tool`, `ip_hash_day`, `user_id null`, `created_at`, `converted_user_id null` (for the tool-conversion metric; no raw IP) |

### 7.6 Social

| Table | Columns |
| --- | --- |
| `match_suggestions` | `id`, `user_id`, `candidate_user_id`, `mode enum(study, teammate, explore)`, `score real`, `components jsonb`, `explanation_keys jsonb`, `shown_on date`, `action enum(liked, skipped, requested) null`, `acted_at`; unique `(user_id, candidate_user_id, shown_on)` |
| `connections` | `user_a`, `user_b` (stored with `user_a < user_b`), `source enum(match, swap, squad, review, adoption, legacy, alumni)`, `created_at`; pk `(user_a, user_b)` |
| `message_requests` | `id`, `from_user`, `to_user`, `context_kind`, `context_id null`, `icebreaker_key null`, `first_message`, `status enum(pending, accepted, declined, expired)`, `responded_at`; partial unique on `(from_user, to_user)` where `status = 'pending'` |
| `threads` | `id`, `kind enum(direct, group, squad, swap, adoption)`, `title null`, `created_at` |
| `thread_members` | `thread_id`, `user_id`, `joined_at`, `last_read_at`, `muted boolean`; pk `(thread_id, user_id)` |
| `messages` | `id`, `thread_id`, `author_user_id null`, `kind enum(user, system)`, `body`, `created_at`, `edited_at`, `deleted_at`; index `(thread_id, created_at)` |
| `blocks` | `blocker`, `blocked`, `created_at`; pk `(blocker, blocked)` |
| `reports` | `id`, `reporter`, `target_user`, `target_message null`, `reason enum(spam, harassment, impersonation, inappropriate, other)`, `details`, `status enum(open, actioned, dismissed)`, `resolved_by`, `resolved_at` |
| `trust_scores` | `user_id pk`, `score real`, `multiplier real`, `components jsonb`, `computed_at` |

### 7.7 Streaks

| Table | Columns |
| --- | --- |
| `pairs` | `id`, `user_a`, `user_b`, `status enum(active, paused, ended)`, `current_streak int`, `longest_streak int`, `freezes_available smallint`, `missed_in_row smallint`, `last_judged_day date`, `created_at`, `ended_at`; unique active pair per two users |
| `pair_days` | `pair_id`, `day date`, `a_count int`, `b_count int`, `outcome enum(counted, frozen, missed)`; pk `(pair_id, day)` |
| `pair_companions` | `pair_id pk`, `seed bigint`, `stage smallint`, `mood enum(happy, neutral, sad)`, `updated_at` |

### 7.8 Collaboration

| Table | Columns |
| --- | --- |
| `graveyard_listings` | `id`, `repo_github_id`, `owner_user_id`, `status enum(listed, adopted, withdrawn)`, `note`, `listed_at` |
| `listing_suggestions` | `owner_user_id`, `repo_github_id`, `suggested_at`, `dismissed_at`; pk `(owner_user_id, repo_github_id)` |
| `adoptions` | `id`, `listing_id null`, `repo_github_id`, `adopter_user_id`, `fork_full_name null`, `status enum(requested, active, revived, dropped)`, `created_at`, `revived_at` |
| `review_requests` | `id`, `author_user_id`, `university_id`, `pr_url`, `repo_full_name`, `pr_number int`, `languages text[]`, `status enum(open, claimed, submitted, settled_helpful, settled_unhelpful, expired, disputed)`, `claimed_by null`, `claimed_at`, `expires_at` |
| `reviews` | `id`, `request_id unique`, `reviewer_user_id`, `gh_review_ids bigint[]`, `line_comment_count int`, `verified_at`, `rating enum(helpful, unhelpful) null`, `rated_at` |
| `credit_ledger` | `id bigserial`, `user_id`, `delta int`, `reason enum(starter, escrow, release, refund, admin_adjust)`, `request_id null`, `created_at`; append-only (no update/delete grants); view `credit_balances` = sum by user |
| `ledger_locks` | `user_id pk` — one row per member, locked `for update` around ledger writes |
| `swap_offers` | `user_id`, `tag`, `level real`, `verified boolean`; pk `(user_id, tag)` |
| `swap_wants` | `user_id`, `tag`, `priority smallint`; pk `(user_id, tag)` |
| `swap_proposals` | `id`, `members uuid[]`, `edges jsonb` (\[{from, to, tag}\]), `quality real`, `status enum(proposed, accepted, declined, expired)`, `created_at`, `expires_at` |
| `swap_responses` | `proposal_id`, `user_id`, `response enum(accept, decline)`, `responded_at`; pk `(proposal_id, user_id)` |
| `legacy_entries` | `id`, `university_id`, `owner_user_id`, `repo_github_id`, `source enum(showcase, fyp)`, `grad_year smallint null`, `tags text[]`, `blurb`, `accepts_questions boolean`, `created_at`; unique `(owner_user_id, repo_github_id)` |

### 7.9 Crowd

| Table | Columns |
| --- | --- |
| `crawl_cursors` | `id`, `seed`, `created_from date`, `created_to date`, `page int`, `total_count int`, `status enum(pending, splitting, running, done)`, `updated_at` |
| `crawl_optouts` | `github_login citext pk`, `created_at` |
| `leaderboard_snapshots` | `id`, `scope enum(university, department)`, `scope_id`, `week_start date`, `metrics jsonb`, `rank int`; unique `(scope, scope_id, week_start)` |
| `leaderboard_optins` | `user_id pk`, `opted_in_at` |
| `alumni_questions` | `id`, `asker_user_id`, `university_id`, `body`, `tags text[]`, `anonymous boolean`, `status enum(open, answered, closed, expired)`, `round smallint`, `answered_at` |
| `question_routes` | `question_id`, `alumni_user_id`, `round smallint`, `routed_at`, `responded_at null`, `status enum(pending, answered, passed, expired)`; pk `(question_id, alumni_user_id)` |
| `events` | `id`, `creator_user_id`, `title`, `description`, `visibility enum(university, country, public)`, `university_id null`, `country_code null`, `starts_at`, `ends_at`, `team_size smallint`, `status enum(open, forming, finalized, closed)` |
| `event_participants` | `event_id`, `user_id`, `availability jsonb`, `locked_group_key null`, `joined_at`; pk `(event_id, user_id)` |
| `squads` | `id`, `event_id`, `version int`, `status enum(proposed, final)`, `created_at` |
| `squad_members` | `squad_id`, `user_id`, `role_label`; pk `(squad_id, user_id)` |
| `squad_swap_requests` | `id`, `event_id`, `from_user`, `to_squad_id`, `status enum(pending, done, rejected)`, `created_at` |
| `fyp_ideas` | `id`, `university_id`, `author_user_id`, `title`, `description`, `keyphrases text[]`, `status enum(open, team_forming, taken, archived)`, `search_tsv tsvector` (generated); GIN index |
| `fyp_projects` | `id`, `university_id`, `repo_github_id`, `year smallint null`, `submitted_by null`, `auto_detected boolean`, `confirmed boolean` |
| `fyp_supervisors` | `user_id`, `university_id`, `approved_by`, `areas text[]`, `approved_at`; pk `(user_id, university_id)` |
| `fyp_interest` | `idea_id`, `user_id`, `message`, `created_at`; pk `(idea_id, user_id)` |

## 8. Feature specifications

Each feature below is a contract: inputs, data fetched, algorithm, output, settings, storage, UI states, edge cases, privacy and tests. Pure formulas go in `packages/algorithms`; orchestration in `packages/core/<domain>`; pages in `apps/web`.

If a spec introduces a settings key not yet in §5.5.1, add it there and to the seed migration in the same task.

### 8A. Day-one tools

### F1. Dev Card

**Outcome.** A visual profile built from real GitHub activity: languages, verified skill tags, coding rhythm, personality labels and a generated companion.

**Tier.** Day-one for anyone; members also get a persistent page at `/u/[login]`.

**Routes.** `/tools/dev-card` (input + result), `POST /api/tools/dev-card`, `/u/[login]` (members, visibility-aware), `GET /api/og/dev-card?login=` (members only).

**Input.** `{ login: string }`, validated by the regex in §5.3.

**Data fetched** (job `analyze_profile`, identity: the member's own token when they analyze themselves, else `server`):

1. GraphQL `repositoryOwner(login)` → `__typename`. Organizations and bots are rejected.
2. GraphQL `user(login)`: `databaseId`, `login`, `name`, `location`, `createdAt`, `pinnedItems(first: 6)`, `repositories(ownerAffiliations: OWNER, isFork: false, first: <page>, orderBy: {field: PUSHED_AT, direction: DESC})` with `languages(first: 10) { edges { size node { name } } }`, `stargazerCount`, `forkCount`, `repositoryTopics`, `pushedAt`, `homepageUrl`, `licenseInfo`, `description`. Capped at `github.maxReposPerProfile`.
3. GraphQL `contributionsCollection` for the last 365 days: `contributionCalendar { weeks { contributionDays { date contributionCount } } }`, `restrictedContributionsCount`, `totalCommitContributions`.
4. REST `GET /users/{login}/events/public` (paginate up to the API's window). Keep `PushEvent` (with commit count), `PullRequestEvent`, `IssuesEvent`, `PullRequestReviewEvent`, `CreateEvent` timestamps.
5. Manifests for the top `persona.manifestRepos` repos by `pushedAt` (new key, default 10): `GET /repos/{o}/{r}/contents/<path>` for each manifest file found in the root listing. Parse dependencies (P2-T02) and enqueue `enrich_packages` for unknown packages.

**Algorithm.**

1. **Timezone.** Member → profile timezone. Non-member → geocode `location` (cached; F18 rules) → coordinates → timezone. Unknown → UTC, and the result says so.
2. **Hour histogram.** For each event, convert `created_at` to the timezone and add its weight to `hourHist[hour]`. Weight = commit count for `PushEvent` (capped at 20), otherwise 1. Normalize to shares.
3. **Shares.** `nightShare` = hours 22–23 and 0–3; `morningShare` = hours 5–8; `weekendShare` = Saturday + Sunday share of daily calendar counts over the last 90 days.
4. **Rhythm.** Over the last 90 calendar days: `activeDayShare` = days with count > 0 ÷ 90; `cv` = standard deviation ÷ mean of daily counts (0 if mean is 0); `longestStreak` over 365 days.
5. **Languages.** Sum `languages.edges.size` across non-fork repos; normalize; keep the top 6 plus "other".
6. **Skill tags.** For each dependency, take `package_meta.derived_tags`; weight each tag by the number of repos using it; add repo topics with weight 1 per repo; normalize to \[0, 1\] by the max. Keep the top 12.
7. **Labels.** For each label, compare the metric with its threshold (`getSetting`):
   - Night Owl: `nightShare ≥ persona.nightOwl.share`
   - Early Bird: `morningShare ≥ persona.earlyBird.share`
   - Weekend Warrior: `weekendShare ≥ persona.weekendWarrior.share`
   - Sprinter: `cv ≥ persona.sprinter.cv`
   - Marathoner: `activeDayShare ≥ persona.marathoner.activeDayShare`
   - Strength = metric ÷ threshold. Show at most 3 labels, strongest first. None → "Balanced".
8. **Activity score** in \[0, 1\]: the percentile rank of `totalContributions365` within `metric_samples('contrib.total365')` once that metric has `min_sample` samples; before that, `min(1, log10(1 + x) / log10(1 + companion.activityRef))` (new key, default 1000).
9. **Companion.** Seed = GitHub `databaseId`. Species from the top skill tag (or primary language) hashed into the species list. Palette from the top language's Linguist color. Stage = index of the first `companion.stageCuts` value above the activity score. Traits from badges (§9.5).
10. **Samples.** Write anonymous `metric_samples` for `persona.nightShare`, `persona.morningShare`, `persona.weekendShare`, `persona.cv`, `persona.activeDayShare`, `contrib.total365` (§5.12 dedupe).

**Output** (`analysis_cache` kind `dev_card`, TTL `cache.devCardTtlHours`):

```ts
type DevCard = {
  login: string; name: string | null; avatarUrl: string; timezone: string; timezoneSource: 'profile' | 'location' | 'utc';
  window: { eventsFrom: string; eventsTo: string };       // shown as "last 90 days"
  languages: { name: string; share: number; color: string | null }[];
  tags: { tag: string; weight: number }[];
  hourHist: number[];                                      // 24 shares
  metrics: { nightShare: number; morningShare: number; weekendShare: number; cv: number; activeDayShare: number; longestStreak: number; total365: number; privateIncluded: boolean };
  labels: { key: string; strength: number }[];
  activityScore: number;
  companion: { seed: number; species: number; paletteHex: string; stage: number; traits: string[] };
  calendar90: { date: string; count: number }[];
};
```

**UI states.** Input → Working (steps: "Finding @login", "Reading repos", "Reading activity", "Building your card") → Done (card) | Waiting | Error (§5.14).

**Card layout.** Companion and name at the top; up to 3 label chips; a language bar; a 24-hour rhythm strip; a 90-day mini heatmap; stats (longest streak, active days, top tags). A "last 90 days" note and the timezone source appear under the rhythm strip.

**Edge cases.**

- Organization or bot account → Error with specific copy.
- Zero public repos and fewer than `persona.minEvents` events → Idle state with a sign-in suggestion; no labels.
- Huge accounts: caps from settings; the card notes "based on your 100 most recent repos".
- Renamed login: GitHub redirects; store the canonical login.
- 404 → Error ("couldn't find").

**Privacy.** Non-member results: page `noindex`, no share URL or image, deleted after `privacy.nonUserRawTtlHours`. Members: `/u/[login]` follows profile `visibility`.

**Tests.** Pure metric functions (empty, single event, DST boundaries); label thresholds read from settings; companion determinism by seed; organization rejection; `noindex` for non-members (e2e).

### F2. Compatibility Check

**Outcome.** Enter two GitHub usernames and get a playful 0–100 "coding partner compatibility" score with an honest breakdown. It is the viral front door to matching (F11).

**Tier.** Day-one.

**Routes.** `/tools/compat` (two inputs; the first prefilled with the signed-in member), `POST /api/tools/compat`, `GET /api/og/compat?a=&b=` (rules below).

**Input.** `{ a: string; b: string }`. Logins are compared case-insensitively; identical logins are rejected.

**Data.** Job `compat_check` reuses F1 results for both users from `analysis_cache`. Missing ones are computed inline within the deadline (same steps as F1); if the budget runs out, the job returns `continue`. It also fetches up to `matching.starCap` recently starred repos for each user (REST `/users/{login}/starred`, newest first) for their topics.

**Algorithm.** All components are in \[0, 1\].

1. **Skill** = cosine similarity of the two vectors built from language shares ∪ skill tags (F1 steps 5–6).
2. **Interest** = Jaccard similarity of topic sets: topics of owned repos ∪ topics of starred repos.
3. **Rhythm** = histogram intersection of the two hour histograms, both in UTC (overlap of when they actually code): `Σ_h min(hA[h], hB[h])`.
4. **Complement** = mean of `|a[t] − b[t]|` over the union of both users' top 10 tags, where `a` and `b` are each user's tag weights normalized to \[0, 1\]. High when one is strong where the other is weak.
5. **Score** = `round(100 × Σ w_k × component_k)` with weights from `compat.weights`. Band = the highest `compat.bands` entry whose `min` ≤ score.
6. **Explanations** (template keys plus values, never generated text):
   - up to 3 shared skill tags;
   - up to 3 repos both have starred;
   - the longest window of hours where both have activity share above their own median, converted to the viewer's timezone;
   - one strength each brings that the other lacks (largest positive `a[t] − b[t]` and `b[t] − a[t]`).

**Output** (`analysis_cache` kind `compat`, subject key = the two logins sorted, TTL `cache.compatTtlHours`): score, band key, four components, explanation items, both companions.

**UI.** Two companions face each other; the score counts up; a band title (copy from `copy/compat.ts` by band key); four component bars with one-line explanations; CTA "Find people like this at your uni" → sign-in → F11.

**Edge cases.** One user has too little data → show the components that can be computed, mark others "not enough data", and compute the score from the available components with re-normalized weights. Organization → Error.

**Privacy.** Results are visible only to the requester, `noindex`, never persisted beyond `privacy.nonUserRawTtlHours` unless both users are members. The share image and share URL exist only when both users are members with `visibility = public`, or when the requester is one of the two and the other is a member with `visibility = public`.

**Tests.** Each component with hand-computed fixtures; weight re-normalization; band selection; sorted cache key; share rules.

### F3. Recruiter-Ready Score

**Outcome.** A 0–100 score for how a GitHub profile reads to a recruiter in the first minute, with evidence and a concrete fix for every rule.

**Tier.** Day-one. The secret scan runs only for a signed-in member checking their own account.

**Routes.** `/tools/recruiter`, `POST /api/tools/recruiter`.

**Input.** `{ login: string; resumeSkills?: string[] }` (optional skills pasted by the user, max 30 entries).

**Data.** Reuses F1 data, plus: the `<login>/<login>` profile repository (exists? README?), README text of each pinned repo (REST `/repos/{o}/{r}/readme`, raw), and own commit messages from `PushEvent` payloads in the events window.

**Rules.** Each returns a credit in \[0, 1\], evidence and a fix copy key. Weights come from `recruiter.weights`; the default JSON is:

```json
{"profileReadme":10,"pinnedCount":10,"pinnedReadme":15,"pinnedDemo":10,"pinnedLicense":5,"pinnedDescription":5,"pinnedTopics":5,"commitMessages":15,"unfinishedRatio":10,"languageMatch":5,"activityConsistency":10}
```

| Rule | Credit |
| --- | --- |
| `profileReadme` | 1 if the profile repo has a README of at least 200 characters (new key `recruiter.profileReadme.minChars`), else 0 |
| `pinnedCount` | 1 if pinned count is within \[`recruiter.pinned.min`, `recruiter.pinned.max`\]; 0.5 if 1; else 0 |
| `pinnedReadme` | Share of pinned repos with README length ≥ `recruiter.readme.minChars` |
| `pinnedDemo` | Share of pinned repos with a `homepageUrl`, or a README link to an http(s) URL outside github.com |
| `pinnedLicense` | Share of pinned repos with a license |
| `pinnedDescription` | Share of pinned repos with a description |
| `pinnedTopics` | Share of pinned repos with at least one topic |
| `commitMessages` | Share of own commit messages that are informative (below) |
| `unfinishedRatio` | `1 − share of non-fork repos with unfinished score ≥ 0.5` (F7 signals) |
| `languageMatch` | Applies only with `resumeSkills`: share of claimed skills that appear in the user's languages or skill tags (matched through topic aliases) |
| `activityConsistency` | `min(1, activeDayShare / persona.marathoner.activeDayShare)` |

**Informative commit message.** Normalize (lowercase, trim, collapse whitespace, strip issue numbers). It is informative when it has at least `recruiter.minMessageTokens` tokens and is not among the `recruiter.genericMessageTopK` most frequent normalized short messages in `generic_message_counts`. That table stores only normalized messages of at most `recruiter.minMessageTokens + 2` tokens, with counts and no identifiers (add the table to §7.4). Until it has data, only the token rule applies.

**Score.** `100 × Σ(weight × credit) / Σ(weight of applicable rules)`, rounded.

**Secret scan (owner only).** Runs when the signed-in member's GitHub login equals the input login.

1. Choose pinned repos, then the top repos by stars, until `recruiter.secretScan.maxFiles` files are covered.
2. List each repo tree (`GET /git/trees/<branch>?recursive=1`). Keep text files by Linguist extension, size ≤ `recruiter.secretScan.maxFileBytes`, and not matching vendored patterns.
3. Fetch blobs; for each `secret_rules` rule: keyword prefilter → RE2 regex → entropy check when the rule has one.
4. Store `{ rule_id, repo, path, line }` only. Never store or display the matched value; show the line number and a masked hint ("starts with sk\_…").
5. The fix text explains that deleting the file does not remove the secret from git history, and that the key must be revoked and rotated.

**UI.** Score dial; rules as a checklist (pass / partial / fail), each with evidence ("3 of 5 pinned repos have a README over 600 characters") and the fix; the owner-only secret panel in a warning style.

**Edge cases.** No pinned repos → pinned rules use the top 6 repos by stars and say so. A truncated tree → "partial scan" note. No events → `commitMessages` not applicable.

**Privacy.** Non-member reports follow class C retention. Secret findings are readable only by the owner (server checks `github_identities.login = login`).

**Tests.** Each rule with fixtures; partial credit; re-normalization when rules don't apply; secret scan never persists values (assert on stored JSON); owner-only access.

### F4. Group Fairness Report

**Outcome.** A neutral, evidence-based picture of who contributed what code to a team repository.

**Tier.** Day-one.

**Routes.** `/tools/fairness`, `POST /api/tools/fairness`.

**Input.** `{ repoUrl: string }`, parsed with `parseGitHubUrl`. Public repositories only.

**Data** (job `fairness_report`):

1. `GET /repos/{o}/{r}` (exists, public, not a fork of something larger than itself).
2. `GET /repos/{o}/{r}/stats/contributors` with 202 retries (§5.6). Per author: total commits and weekly additions, deletions and commits. Merge and empty commits are excluded by GitHub.
3. `GET /repos/{o}/{r}/commits` (paginated, up to `fairness.maxCommits`) for author emails and names, `Co-authored-by:` trailers, and unlinked authors.
4. Tree listing + `.gitattributes` (if present). Paths matching `linguist-vendored`, `linguist-generated` or `linguist-documentation` attributes, or the Linguist `path_patterns`, are excluded.
5. If excluded paths exist: `GET /repos/{o}/{r}/commits/{sha}` for up to `fairness.maxCommits` commits to subtract lines in excluded paths per author. Otherwise use the stats totals.

**Algorithm.**

1. Build people: linked authors by GitHub id; unlinked authors grouped by email.
2. Co-authors: each `Co-authored-by` trailer gives the co-author one commit credit and an equal share of that commit's lines.
3. Per person: commits, lines added, lines deleted (after exclusion), active weeks, files touched (when per-commit data was fetched), first and last activity, late share = share of their commits in the final `fairness.lateWindowPct` of the repo's active timeline.
4. Team metrics on the selected metric (commits by default; the user can switch to lines):
   - Gini `G = Σ_i Σ_j |x_i − x_j| / (2 n² x̄)`;
   - least-share ratio = `min share ÷ (1 / n)`;
   - `flagged = leastShareRatio < fairness.leastShareThreshold`.
5. Timeline: commits per person per week.

**Identity merge.** The UI lists unlinked identities with their counts. The user can merge any identity into a person; recomputation runs in the browser with the same pure functions from `packages/algorithms`. Merges are not saved unless the repo owner is the signed-in member.

**UI.** Contribution share bars per person; a metric switch (commits, lines); a weekly timeline chart; team metrics with plain-language explanations; an "excluded N lines in generated or vendored files" note; an identity-merge panel.

**Copy rules.** The heading says "Code contribution report". A flagged team reads: "Contribution is uneven: the smallest share is below 14% of an equal split." Never name a person as the problem. A note explains that design, writing, testing outside the repo and meetings are not visible here.

**Edge cases.** One contributor → metrics not applicable. Repos with more than 10,000 commits (stats unavailable) → commits-list-only mode with a note. Private or missing repo → Error. Bots (`[bot]` suffix or `type: Bot`) excluded by default with a toggle.

**Tests.** Gini and least-share against hand-computed fixtures; co-author splitting; vendored exclusion; 202 retry path; bot exclusion.

### F5. Gap Finder

**Outcome.** Paste a project repo; see what similar successful projects usually have that yours doesn't (for example CI workflows, tests, containerization, docs); members then see who at their university has those skills.

**Tier.** Day-one (gap analysis). Campus layer (who can help) unlocks at `unlock.gapCampus.minMembers`.

**Routes.** `/tools/gap`, `POST /api/tools/gap`.

**Input.** `{ repoUrl: string }` (public repo).

**Data and algorithm** (job `gap_analysis`):

1. **The repo's facets.**
   - Path features from the root listing: every root entry becomes `dir:<name>` or `file:<name>` (lowercased), plus `dir:.github/workflows` when it exists. Nothing is hand-listed; noise is removed by prevalence in step 4.
   - Dependency tags: manifests → dependencies → `package_meta.derived_tags`.
   - Meta facets: `meta:license`, `meta:homepage`, `meta:releases`, `meta:topics`, `meta:description`.
2. **Peers.** Use F6 to expand the repo's top topics, primary language and top 3 dependency tags. Search repos with `stars:>=gap.minPeerStars`, pushed within the last year, excluding the repo and its forks. Keep the `gap.peerSampleSize` best matches.
3. **Peer facets.** Same extraction for each peer (root listing + manifests, bounded by budget; store in `repo_paths` and `repo_dependencies` for reuse).
4. **Prevalence.** `p(f)` = share of peers that have facet `f`. Expected facets are those with `p(f) ≥ gap.minPrevalence`.
5. **Gaps.** Expected facets the repo lacks, ranked by `p(f)` descending, top `gap.maxGaps`.
6. **Labels.** For path features, show the path itself; if a topic slug or alias matches the feature name (e.g. `dockerfile` → topic `docker`), add that topic's display name. Tag facets show the topic display name. No hand-written explanations.
7. **Campus layer** (members, unlocked): for each gap that maps to tags, find verified members at the same university whose skill vector has that tag at or above `swap.minTeachLevel` (percentile within the university). Show up to 3 per gap with an "Ask" button that opens a message request with `context_kind = 'gap'`.

**Output** (`gap_reports` + `analysis_cache` kind `gap`, TTL `cache.gapTtlHours`): the repo's facets, the peer list (names, stars), and gaps with prevalence ("24 of 30 similar repos").

**UI.** A checklist of gaps sorted by prevalence, each with "N of M similar repos have this" and links to 3 example peers; the campus panel (or its Unlock card); a list of facets the repo already shares with its peers ("You're doing these right").

**Edge cases.** Too few peers (fewer than `gap.peerSampleSize / 3`) → show results with a low-confidence note. Monorepos → root features may be unusual; the note suggests a sub-project link. Empty repo → Error.

**Tests.** Facet extraction; prevalence and ranking; label resolution through topic aliases; campus query respects visibility, blocks and ghost mode.

### F6. Taxonomy engine (shared service)

**Outcome.** Given any search term ("computer vision"), learn which GitHub topics and dependencies belong to it, from live data. Used by F5, F7, F8, F9, F11 and F17. Nothing is hand-listed.

**API.** `core/taxonomy.expand(term): Promise<Expansion>` (cached), and job `taxonomy_expand` for cache misses.

**Algorithm.**

1. **Normalize** the term: lowercase, trim, collapse spaces; `slug` = spaces → hyphens.
2. **Aliases.** If `topics` has the slug (or the slug is in some topic's `aliases`), seed the expansion with that topic, its aliases and its `related` list (score 1.0 for aliases, 0.5 for related).
3. **Sample.** GitHub repository search for `<term> in:name,description,readme`, plus `topic:<slug>` when the topic exists, sorted by best match. Take up to `taxonomy.sampleSize` repos (1–2 search calls through the pacer).
4. **Collect** each sampled repo's topics. For the top 30 sampled repos, also collect dependency names from their manifests (bounded by budget; reuse `repo_dependencies` if cached).
5. **Score each candidate** `x`:
   - `sampleFreq(x)` = share of sampled repos containing `x`.
   - Topics: `globalCount(x)` = GitHub's `total_count` for `topic:x`, cached in `topic_global_counts` (fetched lazily; search pacer applies).
   - Dependencies: `globalCount(x)` = count of repos using `x` in our `repo_dependencies` once it holds `taxonomy.minCorpus` repos; before that, dependencies are scored on `sampleFreq` alone.
   - `score(x) = sampleFreq(x) × log(1 + maxGlobal / globalCount(x))`, where `maxGlobal` is the largest `globalCount` among this term's candidates (so no constant is needed).
6. **Keep** candidates with `sampleFreq ≥ taxonomy.minSampleFreq`, top `taxonomy.maxExpansions` by score, plus all alias seeds.
7. **Cache** in `taxonomy_expansions` with TTL `cache.taxonomyTtlDays`.

**Output.**

```ts
type Expansion = {
  term: string; slug: string;
  items: { kind: 'topic' | 'dependency'; value: string; score: number; source: 'alias' | 'related' | 'cooccurrence' }[];
  sampleSize: number; computedAt: string;
};
```

**Edge cases.** Zero search results → return the alias seeds only (possibly empty) and let callers fall back to plain full-text search. Terms shorter than 2 characters are rejected.

**Tests.** Scoring with fixtures; alias seeding; dependency scoring before and after `taxonomy.minCorpus`; cache hit.

### F7. Project Graveyard

**Outcome.** Search for inactive projects worth reviving, by topic, at three scopes: My uni, My country, Global. Results are ranked by relevance × revivability, labeled by difficulty, and come with a legal, polite adoption path.

**Tier.** Global is day-one (Phase 2). Uni needs member listings (F14, Phase 5). Country needs the crawler (F18, Phase 6). Locked scopes show their Unlock card.

**Routes.** `/tools/graveyard?q=&scope=&difficulty=&license=` and `POST /api/tools/graveyard` (search job). Members also see the uni tab at `/tools/graveyard?scope=uni`.

**Search pipeline** (job `graveyard_search`, cached per scope and query for `cache.searchTtlHours`):

1. **Expand** the query with F6.
2. **Candidates per scope:**
   - **Global:** GitHub repository search, up to 3 queries built from the term and top expansion items (`<term> in:name,description,readme`, `topic:<slug>`), each with `fork:false pushed:<cutoffDate>` where `cutoffDate = today − graveyard.idleMonths.default`. Up to 100 candidates.
   - **Country:** Postgres full-text search over `gh_repos` where the owner is in the country index (`websearch_to_tsquery` on `search_tsv`, plus topic overlap with the expansion), limit 200.
   - **Uni:** `graveyard_listings` with status `listed` at the member's university, joined to `gh_repos`, matched the same way.
3. **Category.** Category of a candidate = the expansion's top topic present on it (or the query slug). Idle threshold = `graveyard.idleMonths.<category>` if computed, else the default.
4. **Filters:** not a fork; has a README; commit estimate ≥ `graveyard.minCommits` (from the contributors endpoint or a commits `per_page=1` Link header); idle ≥ category threshold. Archived repos are allowed but labeled "Archived — fork only".
5. **Unfinished score** `u ∈ [0, 1]` = mean of the signals that apply (uni-level owners' repos are scored the same way):
   - README contains a term from `graveyard.unfinishedTerms` (word-boundary match), or unchecked task items (`- [ ]`) → 1, else 0;
   - share of the last 10 open issues with no comment from the owner;
   - share of the last 10 commit messages containing an unfinished term;
   - no releases or tags → 1, else 0.
6. **Finished signals** subtract: releases or tags present → −0.25; all issues closed and more than 5 issues total → −0.25; README has a usage or installation heading → −0.15. Clamp to \[0, 1\].
7. **Revivability** (computed for the top `graveyard.deepScoreTopN` by relevance; `recentStars` = stars received after the last push, via `GET /repos/{o}/{r}/stargazers` with the star+json media type, paged from the end, capped):

```text
promise   = log10(1 + stars + 2·forks)
demand    = log10(1 + openIssues + recentStars)
freshness = 1 if idleMonths ≤ graveyard.freshMonths else 0.5
legal     = 1 if license present else graveyard.noLicenseFactor
revivability = (wP·promise_n + wD·demand_n + wU·u + wF·freshness) × legal
```

`promise_n` and `demand_n` are min–max normalized within the candidate set. Weights come from `graveyard.weights`.

8. **Rank** = `relevance × revivability`. Relevance: GitHub's result order for global (converted to a 1 → 0 rank score), `ts_rank_cd` for country and uni.
9. **Difficulty labels** (thresholds relative to the candidate set):
   - "Weekend fix": size below the set's median, open issues below its median, `u < 0.5`.
   - "Needs a maintainer": stars and open issues both above the set's 75th percentile.
   - "Half-built idea": `u ≥ 0.5` and size below the median.
   - Otherwise no label.
10. **Samples.** For active repos encountered in a category (pushed within 30 days), record their median push gap as `metric_samples('graveyard.pushGap.<category>')`. The nightly recompute sets `graveyard.idleMonths.<category>` = p75.

**Adoption actions.**

- **Licensed repo:** "Fork on GitHub" (link to `https://github.com/<o>/<r>/fork`) and "Ask the owner" (prefilled issue link, §6.1) with title "Is this project still maintained?" and a polite body template from `copy/graveyard.ts`.
- **Unlicensed repo:** only "Ask the owner first", with copy explaining that without a license the code can't be reused freely.
- **Members:** the click also records an `adoptions` row (`status = requested`) so F14 can track revival.

**UI.** A search bar; scope tabs (locked tabs show unlock progress); filters for difficulty and license; result cards (name, description, stars, idle time, last push, difficulty label, license chip, revivability bar, "why it's here" signals); adoption buttons.

**Language rules.** Global and country results say "inactive". Uni results always say "up for adoption" and come only from owner opt-in.

**Edge cases.** No candidates → suggest broader terms from the expansion. Rate limited → Waiting state with partial results if any.

**Tests.** Unfinished and finished signals; revivability normalization; difficulty labels relative to the set; license gating; per-category threshold resolution.

### F8. Open-Source Starter

**Outcome.** Beginner-friendly open issues in the user's languages, from projects that respond to newcomers, plus (campus layer) seniors from your university who contributed there.

**Tier.** Day-one; campus layer in Phase 5.

**Routes.** `/tools/oss`, `POST /api/tools/oss`.

**Input.** `{ login?: string; languages?: string[]; topics?: string[] }`. With a login, languages come from F1; otherwise the user picks languages (options from the `languages` table) and optional topics (expanded with F6).

**Algorithm** (job `oss_search`):

1. **Search issues:** `is:issue is:open no:assignee archived:false language:<L>` for up to 3 languages, combined with label terms from `oss.beginnerLabelTerms` (`label:"<term>"`). Two pages maximum per query.
2. **Per candidate repo** (deduplicated; cached per repo for `cache.searchTtlHours`):
   - recently pushed: `pushed_at ≥ today − oss.maxRepoIdleDays`;
   - beginner labels discovered from `GET /repos/{o}/{r}/labels` by matching names against `oss.beginnerLabelTerms`;
   - **responsiveness:** over the last `oss.responsivenessSample` issues (any state) opened by non-maintainers, the median hours from creation to the first comment whose `author_association` is OWNER, MEMBER or COLLABORATOR (issues without such a comment count as the window length). Record each repo's median as a `metric_samples('oss.responseHours')` sample.
3. **Per issue gates:** comments ≤ `oss.maxComments`; no linked pull request (search qualifier `-linked:pr`); repo responsiveness ≤ `oss.maxResponseHours`.
4. **Rank:** `0.5 × skillMatch + 0.3 × freshness + 0.2 × responsiveness_n`. `skillMatch` = overlap between repo languages/topics and the user's; `freshness` = `exp(−ageDays / 30)` (30 is a named constant for a monthly half-life, `// allowed-literal`); `responsiveness_n` = `1 − medianHours / oss.maxResponseHours`.
5. **Campus layer** (Phase 5): for each repo, verified members of the user's university whose merged PRs to that repo are recorded (`oss_member_contribs`, filled weekly by searching `is:pr is:merged author:<login>` per member, paced) → "2 seniors from your uni contributed here" with an Ask button.

**UI.** Issue cards: title, repo, labels, age, comment count, a "maintainers usually reply in about N hours" chip, a skill-match chip, and the campus panel.

**Edge cases.** No results → relax gates in order (comments, then responsiveness) and say which gate was relaxed.

**Tests.** Label discovery; responsiveness median with missing replies; gate relaxation order; ranking.

### F9. FYP Idea Checker

**Outcome.** Paste a final-year-project idea (title + description) and see how close existing projects are: worldwide on day one, and at your own university once its FYP corpus exists (F22).

**Tier.** Day-one.

**Routes.** `/tools/fyp-check`, `POST /api/tools/fyp-check`.

**Input.** `{ title: string (≤ 120 chars); description: string (50–3000 chars) }`.

**Algorithm** (job `fyp_check`):

1. **Keyphrases with YAKE** (implemented in `packages/algorithms/yake`, following the YAKE paper):
   - split into sentences and tokens; mark stopwords using a stopword list fetched from an open-source stopword dataset during P2 and stored as a source snapshot (no hand list);
   - per term features: casing, position, normalized frequency, relatedness to context, spread across sentences; combine into the term score (lower is better);
   - candidate n-grams up to `fyp.yake.ngramMax` words, not starting or ending with a stopword; candidate score from its terms;
   - deduplicate near-identical candidates (normalized Levenshtein similarity ≥ 0.8, a `// allowed-literal` from the reference implementation);
   - keep `fyp.yake.maxKeyphrases`.
2. **Queries.** Build 2–3 GitHub repository searches from the top keyphrases (top 3 together, then the top 2 pairs), each `in:name,description,readme`.
3. **Rerank.** Fetch READMEs of the top `fyp.searchTopN` unique results (raw, truncated to 20,000 characters) and score them with BM25 against the idea text. Parameters `ir.bm25.k1` (default 1.2) and `ir.bm25.b` (default 0.75) are settings (add to §5.5.1).
4. **Similarity %** = BM25 score ÷ the BM25 score of the idea text against itself, capped at 100.
5. **Explain:** shared keyphrases (YAKE on each README, intersected with the idea's), and "unique to your idea" keyphrases (the idea's phrases found in none of the top 5).
6. **Uni first** (when the university's `fyp_projects` count ≥ `fyp.minCorpus`): run BM25 over the uni corpus too and show it as a separate "At your university" list above the global one.

**UI.** Idea form; results grouped into "Very similar" (≥ 70%), "Related" (40–69%) and "Loosely related" (< 40%) — cut-offs from new keys `fyp.bands` (default \[40, 70\]); keyphrase chips; a "what makes yours different" panel built from unique keyphrases.

**Edge cases.** Very short description → validation error with guidance. Non-English text → YAKE still works; stopwords come from the matching language list when available.

**Tests.** YAKE against reference outputs stored as fixtures (generated once from the reference implementation and committed); BM25 against hand-computed values; banding.

### 8B. Foundation and campus features

### F10. University verification

**Outcome.** A member proves they belong to a university, using an email code or two vouches, checked against a live list of university domains.

**Tier.** Foundation; required for every campus feature and the `(app)` route group.

**Routes.** `/onboarding` (steps), Server Actions `startEmailVerification`, `confirmEmailCode`, `requestUniversity`, `vouchFor`; `/admin/universities` (approve requests).

**Flow.**

1. **Sign in with GitHub** (Supabase Auth). On the callback, upsert `users`, `github_identities` (token encrypted), `profiles` (timezone from the browser, sent by the onboarding page), and grant admin if `BOOTSTRAP_ADMIN_GITHUB_ID` matches.
2. **Enter a university email.** Validate the format; lowercase; extract the domain.
   - Reject if the domain or any parent domain is in `disposable_domains`.
   - Find the university: the longest suffix of the domain present in `university_domains`, at a label boundary (§6.4).
   - Not found → offer "Request my university" (creates `university_requests`) and the vouching path.
3. **Send the code** (job `send_otp`, priority INTERACTIVE): check `verify.maxSendsPerDay` and the per-IP bucket; generate the code; store the hash; send through SMTP; never log the code.
4. **Confirm.** Compare the hash in constant time; increment `attempts`; reject after `verify.maxAttempts` or after `expires_at`. On success: set `profiles.university_id`, `verified_at`, `verified_via = 'email'`; record the verification; increment `universities.member_count`.
5. **Vouching path.** A user without a working university email picks their university. Two verified members of that university (`verify.vouchesRequired`) vouch from their profile pages ("I know this person studies here"). Vouchers must themselves be verified for at least 7 days (`verify.voucherMinDays`, new key). On the last vouch, `verified_via = 'vouch'`.
6. **Pending universities.** An admin, or a moderator of the matching university, approves a request: inserts the university (source `admin`) and domain, then notifies the requester to finish email verification.
7. **Onboarding details** after verification: role (student, alumni, or "I supervise projects" → `supervisor_pending`), graduation year, department (typeahead from `departments` with trigram matching; creating a new one is allowed and deduplicated by `normalized_name` similarity ≥ 0.6, a `// allowed-literal` for the trigram default), learning goals (tags from the vocabulary of `package_meta.derived_tags` + topics), visibility, notification preferences.

**Re-verification.** None needed for graduates. If a member changes university, they verify again.

**Edge cases.** University emails with subdomains (`cs.uni.edu`) → suffix match. Shared domains used by several universities (rare in the list) → ask the user to choose among matches. Email bounce → the provider's error is shown as "We couldn't deliver the code. Check the address."

**Privacy.** The university email is stored only until verification succeeds, then replaced by its domain (`email_verifications.email` set to null). Only the university is kept on the profile.

**Tests.** Suffix matching (multi-level, boundary cases like `notuni.edu` vs `uni.edu`); disposable rejection; OTP lifecycle (expiry, attempts, sends per day); vouch rules; e2e with the local mail catcher.

### F11. Matching and Discover

**Outcome.** A daily deck of people at your university who fit what you want: a study buddy (similar), a teammate (complementary), or something in between, with an honest "why".

**Tier.** Campus: `unlock.matching.minMembers` verified members at the university.

**Routes.** `/discover` (deck, mode switch, filters), Server Actions `likeSuggestion`, `skipSuggestion`, `requestFromSuggestion`.

**Vectors** (job `compute_skill_vector`, on sign-in and weekly):

1. Start from F1's language shares and skill tags for the member (using their own token).
2. TF-IDF across the university: `w(t) = tf(t) × log(1 + N / df(t))`, where `N` = verified members at the university and `df(t)` = members with tag `t`. This makes rare skills matter more than ubiquitous ones.
3. L2-normalize and store in `skill_vectors.vector`; `top_tags` = top 12.
4. Interest set = topics of owned repos ∪ topics of up to `matching.starCap` most recently starred repos.
5. Learning goals from the profile become the "wants" vector (weight 1 each).

**Scoring** for user `u` and candidate `c` (same university, verified, not blocked either way, not ghost mode, visibility ≠ hidden, not already connected):

- `sim = cosine(vec_u, vec_c)`
- `int = jaccard(interests_u, interests_c)`
- `comp = Σ_g min(goal_u[g], vec_c_n[g]) / Σ_g goal_u[g]`, where `vec_c_n` is the candidate's vector normalized to \[0, 1\] by its max. If the user has no goals, use `gaps_u` = the university's top 20 tags minus the user's top 12.
- `score_mode = w_sim·sim + w_int·int + w_comp·comp`, weights from `matching.weights[mode]`.

**Deck** (job `match_daily`, nightly per university):

1. Compute scores for all candidate pairs in the university (sparse: only pairs sharing at least one tag, interest or goal coverage).
2. For each user and mode, take the top `matching.deckSize`, skipping candidates already shown `matching.maxDailyImpressions` times today across all decks (exposure cap, processed in random order with a seeded RNG for fairness).
3. Store in `match_suggestions` with components and explanation keys.

**Explanations** (template keys with values): shared top tags ("You both build with react and postgres"); complementary coverage ("They're strong in docker, which is on your learning list"); shared interests ("You both starred 3 of the same repos"); rhythm overlap from F2's rhythm component when both have it.

**Weight tuning** (job `tune_match_weights`, nightly):

1. Success = an accepted message request from a suggestion that reached `matching.successMessages` messages from both sides within 14 days.
2. For each mode, compute the mean of each component over successful and over unsuccessful acted-on suggestions in the last 30 days.
3. Move each weight toward the components with the largest positive difference by at most `matching.weightStep`, then renormalize to sum 1. Require at least 30 successes before any change (`matching.tuneMinSuccesses`, new key).
4. Write the new weights as `computed_value` of `matching.weights` (with history).

**UI.** One card at a time: companion, name, top tags, labels, the "why" lines, actions (Skip, Like, Request chat). Mode tabs. Filters: department, graduation year range, tag. Cold start shows the Unlock card plus "Developers like you on GitHub" (top results of a GitHub user search by the member's top language and country, view-only links, no chat).

**Edge cases.** Small universities just over the threshold → decks may be short; show "You've seen everyone for today". A member with an empty GitHub → similarity is 0, so default them to Explore mode and prompt for learning goals.

**Tests.** TF-IDF weighting; complementarity with and without goals; exposure cap; exclusion rules (blocks, ghost, hidden); tuning bounded by step and minimum successes.

### F12. Chat and Safety

**Outcome.** Safe, real-time conversations that start with consent.

**Tier.** Campus.

**Routes.** `/inbox` (requests and threads), `/inbox/[threadId]`; Server Actions `sendMessageRequest`, `respondToRequest`, `sendMessage`, `blockUser`, `reportUser`, `muteThread`, `leaveThread`; `/admin/moderation`.

**Message requests.**

1. A request needs either a suggested icebreaker (template filled with real shared signals, from `copy/icebreakers.ts`) or a first message of at least `chat.minFirstMessageChars` characters.
2. Daily limit = `round(chat.newThreadsPerDay.base × trust.multiplier)`.
3. Rejected when either side has blocked the other, the target is in ghost mode, or a pending request already exists.
4. The recipient sees the request with context ("from Discover", "about your project \<name>", "from Gap Finder"). Accept → create a `direct` thread with both members and post the first message. Decline → silent to the sender (the request shows "pending" until it expires after 14 days, `chat.requestTtlDays`, new key).

**Messages.** Max `chat.maxMessageChars`. New accounts (younger than `chat.newAccountDays`) may include at most `chat.maxLinksNewAccount` links per message. Messages render as plain text with auto-linked URLs (no HTML, no markdown images). Edits allowed for 10 minutes (`chat.editWindowMinutes`, new key); deletion replaces the body with a system note.

**Realtime.** The client subscribes to `messages` inserts for its threads through Supabase Realtime (RLS from §5.9). Unread counts come from `thread_members.last_read_at`.

**Trust score** (job `compute_trust`, nightly):

- `age` = min(1, account days ÷ 30); `verified` = 1 if verified; `acceptRate` = accepted ÷ sent requests over the last 30 days (0.5 when fewer than 3 sent); `reports` = distinct verified reporters in `safety.reportWindowDays`, capped at 3, divided by 3.
- `score = Σ trust.weights[k] × component_k`, clamped to \[0, 1\].
- `multiplier` = linear map of the score onto `trust.multiplierRange`.

**Reports and auto-hide.** A report records a reason and optional details. When `safety.autoHideReports` distinct verified reporters report the same user within the window, set `users.status = 'hidden_pending_review'`: hidden from Discover, requests and search until an admin or moderator acts. The reported user sees a neutral notice and an appeal link (feedback form).

**Moderation queue.** `/admin/moderation`: open reports grouped by target, with context (the reported message and up to 10 surrounding messages, visible only to moderators handling it), actions: dismiss, warn (system message), suspend for N days, ban. Every action writes `audit_log`.

**Edge cases.** A member deletes their account mid-conversation → the system message from §5.12. Group threads (squads, swaps) use the same tables with `kind` set.

**Tests.** Request rules (limits, blocks, duplicates); RLS isolation; link limits; trust computation; auto-hide threshold counts distinct verified reporters only; moderation actions audited.

### F13. Shared streaks and pair companion

**Outcome.** Two members who agree to keep each other accountable share a streak that grows on days both of them code, plus a shared companion that evolves with it.

**Tier.** Campus.

**Routes.** `/streaks`; Server Actions `invitePair`, `acceptPair`, `endPair`, `useFreeze` (automatic by default).

**Pairing.** Either member of an existing thread can invite the other; acceptance creates a `pairs` row (one active pair per two people; a member can have several pairs, up to `streaks.maxActivePairs`, new key, default 3).

**Daily judgement** (job `streak_check`, hourly):

1. For each active pair, a day `D` is judged once both members' local time has passed midnight after `D` plus `streaks.graceHours`.
2. Fetch each member's contribution count for `D` from the GraphQL contribution calendar (their own token; includes private counts if they enabled them). Note: the calendar's day boundaries follow GitHub's account timezone handling, so record `a_count` and `b_count` as reported and judge with them.
3. Outcome:
   - both ≥ `streaks.minDailyContributions` → `counted`: `current_streak + 1`, update `longest_streak`; every `streaks.freezeEveryDays` counted days earn a freeze (max `streaks.maxFreezes`);
   - otherwise, if a freeze is available → `frozen` (streak unchanged, freeze consumed);
   - otherwise → `missed`: `current_streak = 0`, `missed_in_row + 1`;
   - when `missed_in_row ≥ streaks.pauseAfterMissedDays` → status `paused`, both get a notification suggesting a check-in or a new partner.
4. Update the pair companion: stage = number of `streaks.companionStageDays` thresholds reached by `current_streak`; mood = happy after a counted day, neutral after a frozen day, sad after a miss.

**Rewards.** Cosmetic only (companion stages, badges). Streaks can be gamed with trivial commits, so they never unlock anything of value.

**UI.** The pair companion large in the center; the streak count; a 30-day strip of counted / frozen / missed days; freeze count; the partner's today status ("Sam hasn't coded yet today") only if the partner allows it (`profiles.share_today_status`, new boolean column, default true); a share card.

**Edge cases.** One member deletes their account → pair ends, the other is notified. A member's token becomes invalid → that day is skipped (not missed) and the member is prompted to re-authenticate.

**Tests.** Judgement timing across timezones; freezes earned and consumed; pause after misses; companion stage and mood transitions.

### F14. Adoptions and uni listings

**Outcome.** Members list their own inactive projects as "up for adoption"; classmates adopt them; revivals are tracked and celebrated.

**Tier.** Campus (uni scope of F7).

**Routes.** `/settings/projects` (owner's listings and private suggestions), the uni tab of `/tools/graveyard`, Server Actions `listRepo`, `withdrawListing`, `dismissSuggestion`, `requestAdoption`, `confirmAdoption`.

**Private suggestions** (job `suggest_listings`, weekly per member): the member's own non-fork repos that pass F7's filters (idle, unfinished score ≥ 0.5) and are not already listed or dismissed. Shown only to the owner, never public: "These look paused — want to put any up for adoption?"

**Listing.** The owner adds an optional note ("needs a frontend", max 280 characters). Listings appear in the uni tab of the Graveyard, ranked as in F7 but within the university.

**Adoption flow.**

1. A member clicks "Adopt" → a message request to the owner with `context_kind = 'adoption'` and an `adoptions` row (`requested`).
2. The owner accepts → status `active`; a thread is created; the listing becomes `adopted`. The adopter is shown the fork link and, if the repo has no license, a prompt for the owner to add one (link to GitHub's license chooser page for that repo).
3. The adopter links their fork (or it is detected by `track_revivals` through `GET /repos/{o}/{r}/forks` filtered by the adopter's login).

**Revival tracking** (job `track_revivals`, daily): for `active` adoptions with a known fork, count commits on the fork after the adoption date (`GET /repos/{fork}/commits?since=`). At ≥ `adoptions.reviveMinCommits` → `revived`, `revived_at` set, a "Revived" badge for both owner and adopter, and a notification. After 90 days with no commits (`adoptions.dropAfterDays`, new key) → `dropped` and the listing returns to `listed` if the owner agrees.

**Tests.** Suggestion filtering; listing visibility (uni only); flow transitions; revival counting with `since`.

### F15. Review Exchange

**Outcome.** Give a real code review, get one back. Reviews happen on GitHub itself and are verified through the API, so credits can't be faked.

**Tier.** Campus: `unlock.reviews.minMembers`.

**Routes.** `/reviews` (open requests, my requests, my claims, balance), Server Actions `createReviewRequest`, `claimRequest`, `markSubmitted`, `rateReview`, `openDispute`.

**Credits.** `credit_ledger` is append-only. Balance = sum of `delta`. New verified members receive `reviews.starterCredits` once (reason `starter`). Every ledger write runs in a transaction that first locks the member's `ledger_locks` row (`select … for update`), checks the balance, then inserts.

**Request.**

1. The author submits a pull request URL. Validate with `parseGitHubUrl` (must include `/pull/<n>`), then `GET /repos/{o}/{r}/pulls/{n}`: public repo, state `open`, author's GitHub login is the PR author or a collaborator (`author_association` in OWNER, MEMBER, COLLABORATOR).
2. Languages = Linguist languages of changed files (`GET /pulls/{n}/files` → extensions → `languages.extensions`).
3. Escrow: insert `delta = −1, reason = escrow`. Insufficient balance → error "Review someone else's code to earn a credit."
4. Status `open`, `expires_at = now + reviews.requestTtlDays`.

**Claim and verify.**

1. Reviewers see open requests from their university, sorted by language overlap with their skill vector. They can't claim their own.
2. Claim → status `claimed`, `claimed_at`; claims expire after `reviews.claimTtlHours` (request returns to `open`).
3. The reviewer reviews on GitHub, then clicks "I've submitted my review" → job `verify_review`:
   - `GET /repos/{o}/{r}/pulls/{n}/reviews` → reviews by the reviewer's login submitted after `claimed_at`;
   - `GET /repos/{o}/{r}/pulls/{n}/comments` → line comments by the reviewer after `claimed_at`;
   - verified when a review exists and line comments ≥ `reviews.minLineComments`; store ids and the count; status `submitted`;
   - not yet → the job retries hourly until the claim expires.

**Rating and settlement.** The author rates the review:

- helpful → credit released to the reviewer (`delta = +1, reason = release`), status `settled_helpful`;
- unhelpful → escrow refunded to the author (`+1, refund`), reviewer gets nothing, status `settled_unhelpful`;
- no rating within 7 days (`reviews.autoSettleDays`, new key) → treated as helpful;
- disputes go to `/admin/moderation`.

**Reputation.** Percentile of a member's helpful reviews within the university; shown as a badge tier on their profile.

**Edge cases.** The PR is closed or merged before review → refund. The repo becomes private → refund. A reviewer deletes their review → verification reflects current state at verification time only.

**Tests.** Ledger never negative under concurrency (parallel claims and settlements); escrow, release and refund paths; verification counts only comments after the claim; expiries.

### F16. Verified Skill Swap

**Outcome.** "I'll help you with React (verified from my code) if you help me with Flutter." Direct and three-way swaps among members of a university.

**Tier.** Campus: `unlock.swap.minMembers`.

**Routes.** `/swaps` (my offers, my wants, proposals), Server Actions `setOffers`, `setWants`, `respondToProposal`.

**Offers and wants.**

- Offers are suggested from the member's skill vector: tags whose weight percentile within the university ≥ `swap.minTeachLevel`, marked `verified = true`. Members can add other tags as self-declared (`verified = false`); they show a "self-declared" badge.
- Wants come from learning goals plus anything the member adds (from the tag vocabulary).

**Proposal generation** (job `propose_swaps`, nightly per university):

1. Build a directed graph: edge `A → B` labeled `t` when A offers `t` and B wants `t`. Edge quality = A's level in `t` × B's priority for `t` (normalized).
2. Find 2-cycles (`A → B → A`) and, if `swap.maxCycleLength ≥ 3`, 3-cycles (`A → B → C → A`) with depth-limited DFS, skipping blocked pairs, ghost-mode members and members already in an open proposal.
3. Score each cycle = mean edge quality; prefer verified edges (self-declared edges count half).
4. Greedily select non-overlapping cycles by score; store as `swap_proposals` with `expires_at` = 7 days.

**Accepting.** Every member must accept. When all have, a `swap` group thread is created with a system message listing who helps whom with what. Any decline → proposal `declined`; members return to the pool next night.

**Tests.** Graph construction; 2- and 3-cycle detection; non-overlap selection; self-declared weighting; expiry.

### F17. Senior's Legacy

**Outcome.** A browsable library of projects built by seniors and alumni of your university, filterable by topic, year and stack, with an "Ask the author" button.

**Tier.** Campus: `unlock.legacy.minProjects` entries at the university.

**Routes.** `/legacy` (browse, filters), `/settings/projects` (add showcase entries), Server Action `addLegacyEntry`, `removeLegacyEntry`, `askAuthor`.

**Sources of entries.**

- **Showcase:** members choose any of their public repos to showcase, with a short blurb and whether they accept questions.
- **FYP projects:** confirmed `fyp_projects` (F22) whose submitter or owner is a member.
- Entries from members whose `grad_year ≤ current year + legacy.minGradYearsAgo` are labeled "senior" or "alumni"; others still appear, labeled by year.

**Indexing** (job `legacy_refresh`, weekly): refresh repo metadata, recompute each entry's tags (repo topics + dependency derived tags) and the search text.

**Search.** Query → F6 expansion → full-text and tag overlap within the university's entries; filters for graduation year range, department and tag; sort by relevance or by stars.

**Ask the author.** If the author is a member who accepts questions → message request with `context_kind = 'legacy'`. If the author has become alumni and set questions off → the button routes the question through F20 instead, when unlocked.

**UI.** Cards with companion, project name, blurb, year, department, tags and stars; a detail view with README excerpt (sanitized), languages and the Ask button.

**Privacy.** Only member-owned, explicitly added or confirmed entries appear. Visibility follows the owner's profile.

**Tests.** Entry eligibility; search with expansion; visibility rules; Ask routing to chat vs alumni.

### 8C. Crowd features

### F18. Country crawler and geocoding

**Outcome.** A searchable index of public developers and repositories in a country, built slowly and politely, powering the country scope of F7 and "developers like you" lists.

**Tier.** Crowd; runs in the background from Phase 6.

**Routes.** `/admin/crawler` (status, cursors, storage), `/optout` (public form: enter a GitHub login to be removed and never crawled again).

**Seeds** (dynamic):

- the country names of universities with verified members (from `universities.country`);
- city names: resolved `geocode_cache` rows of members' GitHub locations, grouped by `country_code`, keeping cities with at least 2 members (`crawler.minCitySeedMembers`, new key);
- each seed becomes a cursor per country: `location:"<seed>"`.

**Crawl** (job `crawl_country`, priority CRAWL, continuous):

1. Take a `pending` cursor. Query GitHub user search `location:"<seed>" type:user created:<from>..<to>` (first run: account creation range from 2008-01-01 to today; 2008 is GitHub's launch year, `// allowed-literal`).
2. If `total_count > crawler.searchCap`, split the date range in half into two new cursors and mark this one `splitting` → `done`. Repeat until each range fits.
3. Page through results (100 per page) through the search pacer; insert minimal `gh_users` rows with `in_country_index = true`, skipping `crawl_optouts`.
4. For each new user, enqueue a low-priority fetch of up to `crawler.reposPerUser` non-fork repos (metadata only, no READMEs) into `gh_repos`.
5. Storage guard: before inserting, check counts against `crawler.maxUsers` and `crawler.maxRepos`; when exceeded, stop crawling and prune the oldest-fetched rows with the lowest stars until under 95% of the limits.
6. Refresh: re-crawl each cursor every 30 days (`crawler.refreshDays`, new key); delete rows whose user or repo now returns 404.

**Geocoding** (job `geocode_pending`, every minute):

1. New location strings (members, crawled users) are normalized and inserted as `pending` in `geocode_cache` if not already present.
2. Each run resolves at most `floor(remaining budget / geocoder.minIntervalMs)` strings, one at a time: lock `geocoder_lock`, wait until `last_call_at + geocoder.minIntervalMs`, call Nominatim, store result and timezone, update `last_call_at`.
3. Non-place strings (`geocoder.nonPlaceTerms`, empty, URLs) are marked `unresolvable` without a call.

**Privacy.** Only public profile fields needed for search are stored (login, name, location, public repo metadata). Crawled people have no pages, no rankings, and appear only as search results linking to GitHub. The opt-out is honored within one crawl cycle and the login is never re-indexed.

**Tests.** Range splitting until under the cap; opt-out skipping; storage guard pruning; geocoder interval enforced under concurrent ticks.

### F19. Leaderboards

**Outcome.** Friendly competition between universities and departments, measured per capita so size doesn't win.

**Tier.** Crowd: a university appears once it has `unlock.leaderboard.minMembers` verified members.

**Routes.** `/leaderboards` (tabs: universities in your country, departments in your university, opted-in members of your university).

**Weekly snapshot** (job `leaderboard_weekly`, Monday 00:00 UTC):

1. For every verified member, count active days in the past week from the contribution calendar (a day is active if count ≥ 1; at most 1 per day, so commit spam doesn't help).
2. A member is "active" if active days ≥ `leaderboard.minActiveDays`.
3. University metrics: `activeRatio` = active members ÷ verified members; `medianActiveDays`; `revivals` this week (F14); `helpfulReviews` this week (F15).
4. Score = `0.5 × activeRatio_n + 0.3 × medianActiveDays_n + 0.1 × revivals_n + 0.1 × helpfulReviews_n` (weights in `leaderboard.weights`, new key; `_n` = min–max normalized among eligible universities in the same country).
5. Same metrics per department (departments with at least 5 verified members, `leaderboard.minDeptMembers`, new key).
6. Individuals: only members in `leaderboard_optins`, ranked by active days, with ties broken by helpful reviews.
7. Store `leaderboard_snapshots`; show rank change vs last week.

**UI.** Ranked lists with companions (university companions are seeded by university id), the metric breakdown on hover, and "how scoring works" copy.

**Tests.** Per-capita normalization; active-day capping; minimum-member gates; opt-in only for individuals.

### F20. Alumni Quick Asks

**Outcome.** Students ask short questions (max 600 characters) and the best-matched alumni get them, a few at a time, with gentle escalation.

**Tier.** Crowd: `unlock.alumni.minAlumni` alumni at the university.

**Routes.** `/alumni` (ask, my questions, for alumni: my inbox), Server Actions `askQuestion`, `answerQuestion` (opens a thread), `passQuestion`.

**Roles** (job `role_transition`, daily): a student whose `grad_year` is earlier than the current year after July 1 (`alumni.transitionMonth`, new key, default 7) becomes `alumni`, with a notification letting them adjust.

**Routing** (job `alumni_route` on creation and each re-route):

1. Question tags = YAKE keyphrases of the body mapped to the tag vocabulary (exact or alias match), plus tags the asker selects.
2. Candidates: verified alumni of the same university, not blocked, not ghost mode, `open routed questions < alumni.maxOpenPerAlumnus`.
3. Score = `skillOverlap × (1 − load) × responsiveness`, where `skillOverlap` = cosine between question tags and the alumnus' skill vector, `load` = open routed ÷ max open, `responsiveness` = answered ÷ routed over the last 90 days (0.5 with fewer than 3 routed).
4. Route to the top `alumni.routeTopK`; notify them (in-app and digest).
5. **SLA** (job `alumni_sla`, hourly): no answer after `alumni.slaHours` → mark those routes `expired`, increment `round`, and route to the next top K. After `alumni.maxRounds` → question `expired`, asker notified with a suggestion to post in F22 or ask a member.

**Answering.** An alumnus clicks Answer → a direct thread with the asker (bypassing the request step because the asker initiated) and a system message quoting the question. Asking anonymously hides the asker's name until the alumnus answers.

**Tests.** Role transition date logic; routing score; load cap; SLA re-routing and expiry; anonymous reveal on answer.

### F21. Squad Builder

**Outcome.** Organizers create an event; participants opt in; the algorithm proposes balanced teams that cover the roles the event needs.

**Tier.** Crowd: per event, at least `unlock.squads.minParticipants` participants.

**Routes.** `/events` (list, create), `/events/[id]` (join, availability, lock a group, see proposals), Server Actions `createEvent`, `joinEvent`, `lockGroup`, `formSquads` (organizer), `requestSwap`, `finalizeSquads`.

**Roles** (computed per event at formation time):

1. Take participants' skill vectors.
2. Run k-means for `k` in `[2, min(squads.kMax, participants ÷ 2)]` with a seeded initialization (k-means++), choosing `k` with the best mean silhouette score.
3. Name each cluster by the top 2 tags of its centroid (display names from `topics`). These are the event's roles.

**Formation** (job `form_squads`):

1. Team count = `ceil(participants ÷ team_size)` (`team_size` from the event, default `squads.defaultTeamSize`).
2. Place locked groups first, each into its own team.
3. Greedy fill: repeatedly pick the team with the most missing roles and assign the unassigned participant who covers the most of those roles; ties broken by bringing the team's mean activity score closest to the event mean; availability overlap (from `event_participants.availability` time blocks) must be at least 4 hours per week (`squads.minOverlapHours`, new key) when availability was given.
4. Store `squads` (version N, `proposed`) with each member's role label.

**Review.** Participants see their proposed team and can send one swap request to another team (`squad_swap_requests`). The organizer applies accepted swaps and finalizes; final squads get `squad` group threads.

**Tests.** Silhouette-based k selection; locked groups respected; coverage-first greedy; deterministic results with a fixed seed.

### F22. FYP Board

**Outcome.** One place per university for final-year projects: ideas (from students and supervisors), approved supervisors with their areas, team formation, and duplicate checks against the university's past projects.

**Tier.** Crowd: `unlock.fypBoard.minMembers` at the university.

**Routes.** `/fyp` (ideas, supervisors, past projects), `/fyp/ideas/[id]`, Server Actions `postIdea`, `expressInterest`, `markTaken`, `submitPastProject`, `confirmDetectedProject`, `applySupervisor` / moderator `approveSupervisor`.

**Supervisors.** Members with role `supervisor_pending` apply with their areas (tags). A university moderator or admin approves → `fyp_supervisors` row and role `supervisor`. Supervisors can post ideas marked "supervisor idea".

**Ideas.** Title + description (same limits as F9). On posting, YAKE keyphrases are stored and F9's checker runs: uni corpus first (if ≥ `fyp.minCorpus`), then global. Similar results are shown to the author before publishing, with an option to edit. Members express interest with a short message; the author picks teammates, which creates a group thread.

**Past projects corpus.**

- Seniors submit their FYP repo (`submitPastProject`, with year) → `fyp_projects` (`confirmed = true`).
- Job `fyp_detect_projects` (weekly) scans members' repos whose README contains "final year project" or "FYP" (terms in `fyp.detectTerms`, new key, seed vocabulary) and proposes them to the owner for confirmation (`auto_detected = true, confirmed = false` until the owner confirms).
- Confirmed projects feed F9 and F17.

**UI.** Tabs: Ideas (filter by tag, status, supervisor ideas), Supervisors (areas, open slots), Past projects (search). Each idea shows its duplicate-check summary.

**Tests.** Supervisor approval scoped to the moderator's university; duplicate check switching from global to uni at the corpus threshold; detection proposals require owner confirmation.

## 9. Design system

The look: a playful pixel companion living inside a clean, modern product UI, with terminal windows as a recurring motif. Inspired by codemon.pro's feel; every asset, word and layout is our own (§2.10). Dark mode first, with a full light mode.

### 9.1 Principles

1. **The companion is the interface's voice.** Loading, waiting, success, error and empty states are expressed by the companion plus one short line.
2. **Real data, shown fast.** Every tool shows something meaningful within seconds (progress steps, partial results).
3. **Calm surfaces, playful accents.** Neutral backgrounds and cards; color comes from state chips, language colors and the companion.
4. **Explain every number.** Scores always come with "why" lines and a way to improve.
5. **Accessible by default.** WCAG 2.2 AA, keyboard-first, reduced motion respected.

### 9.2 Tokens

Defined as CSS variables in `packages/ui/src/tokens.css` under `:root[data-theme="dark"]` and `:root[data-theme="light"]`, mapped into Tailwind's theme. Components never use raw hex values.

**Color.**

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | #0D0F14 | #F7F6F2 | Page background |
| `--surface` | #151923 | #FFFFFF | Cards, inputs |
| `--surface-2` | #1C2230 | #F0EEE8 | Nested surfaces, table stripes |
| `--border` | #2A3245 | #DDD9CF | Hairlines |
| `--border-strong` | #3A4560 | #C5C0B3 | Hover, focus outlines base |
| `--text` | #E8ECF4 | #151923 | Primary text |
| `--text-muted` | #8C96AB | #5B6475 | Secondary text |
| `--accent` | #7CFF6B | #177A30 | Brand accent, primary buttons, focus ring |
| `--accent-ink` | #0D0F14 | #FFFFFF | Text on accent |
| `--state-idle` | #8C96AB | #5B6475 | Idle chips |
| `--state-working` | #FFC24B | #8F5A00 | Working chips |
| `--state-waiting` | #9B8CFF | #5B45D6 | Waiting chips |
| `--state-done` | #4ADE80 | #136F35 | Done chips |
| `--state-error` | #FF6B6B | #C42B2B | Error chips |
| `--focus` | var(--accent) | var(--accent) | 2px focus ring |

Every text/background pair must pass WCAG AA (4.5:1 for body text, 3:1 for large text and UI glyphs). `pnpm check:contrast` computes all pairs and fails the build otherwise.

**Typography.**

| Role | Font | Size / line height | Weight |
| --- | --- | --- | --- |
| Display (hero) | Pixelify Sans | 48/56 (mobile 36/44) | 500 |
| H1 | Pixelify Sans | 32/40 | 500 |
| H2 | Inter | 24/32 | 600 |
| H3 | Inter | 18/28 | 600 |
| Body | Inter | 16/26 | 400 |
| Small | Inter | 14/22 | 400 |
| Eyebrow | Pixelify Sans, uppercase, letter-spacing 0.08em | 13/20 | 500 |
| Code / terminal | JetBrains Mono | 14/22 | 400 |

Pixelify Sans is never used below 13px or for paragraphs.

**Spacing, radius, elevation.**

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 px (Tailwind defaults).
- Radius: inputs and buttons 10px; cards 16px; chips full pill.
- Elevation: no blurred shadows. The optional "pixel shadow" is `4px 4px 0 var(--border-strong)` on feature cards and the terminal window.
- Layout widths: content 1120px max; reading text 680px max.
- Breakpoints: Tailwind defaults (sm 640, md 768, lg 1024, xl 1280). Mobile-first; everything works at 360px.

### 9.3 Iconography

Material Symbols Rounded, outline style, 20px in UI and 24px in feature cards, color `currentColor`. Self-host only the used subset (generated at build). Icons never carry meaning alone: they always sit next to text or have an `aria-label`.

### 9.4 Components (`packages/ui`)

| Component | Spec |
| --- | --- |
| `Button` | Variants: primary (accent), secondary (surface + border), ghost, danger. Sizes sm/md/lg; min 44px touch height on mobile. Loading state shows a 3-dot pixel spinner and keeps width. |
| `Input`, `Textarea`, `Select`, `Combobox` | Label above, helper text below, error text in `--state-error` with an icon; `aria-describedby` wired. |
| `Card` | Surface, 16px radius, 1px border, optional pixel shadow; header slot with eyebrow + title. |
| `Chip` / `StateChip` | Pill; StateChip = icon + label + state color (idle, working, waiting, done, error). |
| `TerminalWindow` | Window chrome (3 dots, title), monospace body; renders a list of lines with types: command (`$ …`), info, success, warn, error; auto-scroll; `aria-live="polite"`. |
| `CompanionView` | Renders a Commitling (§9.5) at size 64/96/160/240 px with a state; `role="img"` and `aria-label` ("Your companion is working"). |
| `SpeechBubble` | Pixel-bordered bubble attached to a companion; one short line. |
| `UnlockCard` | Lock icon, current/required counts, progress bar, invite button, one-line explanation (§1.4). |
| `ScoreDial` | 0–100 radial gauge drawn in SVG; number in the center; accessible text value. |
| `ChecklistRule` | Pass / partial / fail icon, title, evidence line, expandable fix. |
| `LanguageBar` | Stacked horizontal bar with Linguist colors and a legend; sr-only table. |
| `RhythmStrip` | 24 cells for hours, shaded by share; labels every 6 hours; sr-only list of top hours. |
| `Heatmap` | Calendar grid (7 rows); square cells; tooltip on hover/focus. |
| `BarList`, `Timeline` | Simple SVG charts with axis labels and an sr-only data table. |
| `Tabs`, `Dialog`, `Accordion`, `Toast`, `Tooltip`, `Popover`, `DropdownMenu` | Radix-based, restyled to tokens. |
| `Skeleton` | Neutral blocks matching final layout; no shimmer when reduced motion is on. |
| `EmptyState` | Companion (idle) + title + one line + optional action. |
| `Avatar` | GitHub avatar with a pixel-border frame; falls back to the companion. |
| `DeckCard` | Discover card: companion, name, labels, tags, "why" lines, actions; keyboard shortcuts ← skip, → like, Enter request (with visible hints). |

### 9.5 Companion engine (Commitlings)

Every companion is generated procedurally from a seed, so each member, pair and university gets a unique creature, and no hand-drawn character art is needed.

**Inputs.** `{ seed: number; species: number; paletteHex: string; secondaryHex?: string; stage: 0–4; traits: string[]; state: 'idle'|'working'|'waiting'|'done'|'error' }`.

**Generation** (`packages/ui/src/companion/generate.ts`, pure and deterministic; RNG = mulberry32(seed)):

1. **Grid.** 16 × 16 pixels.
2. **Species parameters** come from a small table of 8 archetypes (envelope width and height, ear type none/pointy/round, tail yes/no, antenna yes/no). These are sprite design constants (`// allowed-literal: sprite design`).
3. **Body mask.** For the left half (columns 0–7), fill cell `(x, y)` when `rng() < density` and the cell lies inside the species ellipse envelope scaled by stage (stage 0 → 0.6, 1 → 0.75, 2 → 0.85, 3 and 4 → 1.0). Mirror to the right half for symmetry.
4. **Clean-up.** Remove isolated pixels (fewer than 2 filled neighbors), then fill enclosed holes (flood fill from the border; unreached empty cells become body).
5. **Features.** Add ears, tail and antenna per species at positions derived from the mask's bounding box.
6. **Outline.** Empty cells 4-adjacent to the body become outline pixels.
7. **Eyes.** Two symmetric eye pixels (white + pupil) at 35% of the body's height from its top, spaced by 30% of its width.
8. **Palette.** From `paletteHex`, derive in OKLCH: base, light (+0.12 L), shade (−0.12 L) and outline (L 0.2); shade the lower third of the body. `secondaryHex` (pair companions) colors the left half's lower third for a two-tone look. Ensure the outline has at least 3:1 contrast against `--surface`.
9. **Traits** stamp small pixel accessories at fixed anchors: `reviewer` (glasses), `reviver` (sprout), `streak` (flame), `oss` (star), `mentor` (cap). Stage 4 adds an accent-colored aura of outline pixels.
10. **Frames per state** (sprite sheet, frames left to right):
    - Idle: 2 frames, body shifts down 1px on frame 2; 1.2s loop.
    - Working: 4-frame walk, alternating foot pixels; 0.6s loop.
    - Waiting: 2-frame foot tap; 0.8s loop; speech bubble shows the ETA.
    - Done: 3-frame hop (up 2px, up 3px, land), played twice, then Idle.
    - Error: eyes become flat lines, body drops 1px; static after 1 frame.
11. **Render.** Output one SVG sprite sheet (crisp `shape-rendering="crispEdges"` rects); `CompanionView` animates it with CSS `steps(n)` on `background-position`. With `prefers-reduced-motion`, show frame 1 only.

**Seeds.** Member: GitHub `databaseId`. Pair: hash of pair id, palettes of both members. University: hash of university id, palette = `--accent`. Non-member Dev Card: GitHub `databaseId` (not stored).

**Tests.** Snapshot of SVG output for fixed seeds and each state; symmetry; determinism; contrast check of outline vs surface.

### 9.6 Page layouts

**Landing (`/`).**

1. Hero: eyebrow ("For student developers"), display headline ("Find your coding partner. Finish what you start."), one subline, primary CTA "Try it with your GitHub", secondary "Sign in".
2. Live demo: a `TerminalWindow` with an input (`$ commitmates card <your-github>`); submitting runs a real Dev Card job and streams progress lines; the companion reacts beside it; the result card appears under it.
3. Five-state strip: the companion in all five states with one-line captions (our own copy).
4. Tools grid: 8 cards (Dev Card, Compatibility, Recruiter Score, Fairness, Gap Finder, Graveyard, OSS Starter, FYP Checker), each with icon, title, one line, "Open".
5. How it works: three steps (Sign in with GitHub → Verify your university → Get matched and build).
6. Campus unlocks: explains unlock cards, with a live example when the visitor is a member.
7. Privacy promise: short bullet list (no AI, no ads, no selling data, delete anytime).
8. FAQ (accordion), footer (attribution, privacy, terms, opt-out, feedback).

**Tool page template (`/tools/*`).** Eyebrow + title + one line → input card → result area (companion states and SSE progress) → result → "Save and share: sign in" CTA for non-members → "Try next" related tools.

**Member home (`/home`).** Today panel (streak status, new suggestions count, unread messages, open review requests), university card with unlock progress, shortcuts to features, recent notifications.

**Other member pages** follow a two-column layout on desktop (main + context sidebar) and a single column on mobile: Discover (deck center, filters sidebar), Inbox (thread list + conversation), Streaks (pair companion center, history sidebar), Reviews (tabs: open, mine, claimed; balance in sidebar), Swaps, Legacy, Leaderboards, Alumni, Events, FYP, Settings (sections: profile, university, projects, notifications, privacy and data).

**Admin (`/admin/*`).** Dense tables, no companions except in empty states: health, metrics, jobs, settings (with history and override), universities and requests, moderation, crawler.

### 9.7 Share images (`/api/og/*`)

1200 × 630, `--bg` dark background, companion at 240px on the left, name and 3 key stats on the right, site name bottom-right, Pixelify Sans headings. Generated with `next/og`. Only for members (and F2 under its rules).

### 9.8 Copy voice

Friendly, short, specific, never shaming. Strings live in `apps/web/src/copy/<domain>.ts`.

| Do | Don't |
| --- | --- |
| "3 of your 5 pinned repos have no README. Add one so recruiters know what they're looking at." | "Your profile is weak." |
| "Contribution is uneven: the smallest share is below 14% of an equal split." | "Ali didn't do his part." |
| "GitHub asked us to slow down — back in about 3 min." | "Error 429." |
| "Up for adoption" | "Abandoned" |
| "Not much public activity in the last 90 days." | "You're inactive." |
| "You've seen everyone for today. New people tomorrow." | "No more matches." |

Length: headlines ≤ 8 words, lines ≤ 20 words, buttons ≤ 3 words. Sentence case everywhere except eyebrows.

### 9.9 Motion

- UI transitions 150–250ms, ease-out; no motion longer than 400ms except the companion loops.
- Score dials and counters animate once on first view.
- `prefers-reduced-motion`: no transitions beyond opacity, companions static, counters show the final value.

### 9.10 Accessibility checklist

- Semantic landmarks; one H1 per page; logical heading order.
- Visible 2px focus ring on every interactive element; no focus traps except dialogs.
- Job progress uses `aria-live="polite"`; errors use `role="alert"`.
- Charts have sr-only tables; companions have state labels.
- Touch targets ≥ 44 × 44 px.
- Forms: labels, descriptions, error messages linked; no placeholder-only labels.
- Every page passes axe with no serious or critical violations (enforced in e2e).

## 10. Coding conventions

### 10.1 TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- No `any`. Use `unknown` and narrow with zod or type guards.
- No non-null assertions (`!`) outside tests.
- `type` for data shapes; `interface` only for contracts meant to be implemented (`SourceModule`, `JobHandler`).
- Named exports only, except files Next.js requires to default-export.
- ESM everywhere.

### 10.2 Naming

- Files: `kebab-case.ts`; React components `PascalCase.tsx`.
- Functions: camelCase verbs (`computeRevivability`, `parseGitHubUrl`).
- Types: PascalCase. Constants: SCREAMING\_SNAKE only for true constants.
- Database: snake\_case tables and columns; Drizzle schema fields in camelCase mapped to snake\_case.
- Settings keys: §5.5 naming.
- Job types: snake\_case verbs (`analyze_profile`).
- Copy keys: dotted (`compat.band.dreamTeam.title`).

### 10.3 Next.js

- Server Components by default. `"use client"` only for interactivity, kept small and at the leaves.
- Pages fetch through `core` services, never directly from `db`.
- Mutations go through Server Actions in `apps/web/src/server/actions/<domain>.ts`:

```ts
'use server';
export async function sendMessageRequest(input: unknown): Promise<ActionResult<{ requestId: string }>> {
  const user = await requireVerified();
  const data = SendMessageRequestSchema.parse(input);
  await guardRate(`write:${user.id}`, 'rate.write');
  const result = await chat.createRequest(user.id, data);   // core service
  revalidatePath('/inbox');
  return ok({ requestId: result.id });
}
// ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; field?: string } }
```

- Errors thrown in actions are caught by a shared wrapper `withAction()` that maps `AppError` to `{ ok: false }` and logs unexpected errors with a reference id.
- Route Handlers only for: public tool endpoints, SSE, OG images, the auth callback, the tick, data export.
- `after()` for post-response work (interactive job start, `tool_sessions` writes).
- Every page exports `generateMetadata`. Tool result pages for non-members set `robots: { index: false }`.
- Use `Suspense` boundaries with skeletons for slow sections; stream where possible.

### 10.4 Errors

```ts
export class AppError extends Error {
  constructor(public code: string, public userMessage: string, public status = 400, options?: { cause?: unknown }) { super(code, options); }
}
// Subclasses: ValidationError(400), NotFoundError(404), ForbiddenError(403), RateLimitedError(429),
// ConflictError(409), ConfigError(500), ExternalServiceError(502), plus GitHub errors (§5.6).
```

- Services throw `AppError` subclasses. Never throw strings.
- Never swallow errors. When catching to add context, rethrow with `cause`.
- `userMessage` is friendly and specific (copy key or sentence); technical detail goes only to logs.

### 10.5 Validation

- zod schemas next to their domain (`packages/core/src/<domain>/schemas.ts`).
- Parse at every boundary: env, action inputs, route inputs, job payloads, external API responses, JSON settings values, URL search params.
- One URL helper (`parseGitHubUrl`) for every GitHub link.

### 10.6 Database

- Access through query modules in `packages/db/src/queries/<group>.ts` returning typed objects. No raw SQL in `core` except through `db.execute(sql\`…\`)\` inside query modules.
- Multi-step writes use `db.transaction`. Ledger writes lock `ledger_locks` first.
- Migrations: generated by `pnpm db:generate`, reviewed, committed. Never edit an applied migration. Destructive changes need a two-step migration and an ADR (§13).
- RLS SQL lives in migrations; every new table gets `enable row level security` in its creating migration.
- Large reads use keyset pagination (`where (created_at, id) < ($1, $2) order by created_at desc, id desc limit $3`), never offset.
- Timestamps in UTC (`timestamptz`).

### 10.7 Algorithms package

- Pure and deterministic: no I/O, no `Date.now()` (time passed in), no `Math.random()` (seeded RNG passed in).
- Settings values are passed in as arguments, never fetched inside.
- Every file starts with a header comment:

```ts
/**
 * Revivability score.
 * Formula: (wP·promise_n + wD·demand_n + wU·unfinished + wF·freshness) × legal
 * Settings: graveyard.weights, graveyard.freshMonths, graveyard.noLicenseFactor
 * Spec: CLAUDE.md §8 F7
 */
```

- Plain typed inputs and outputs; no classes needed.

### 10.8 React and UI

- Components come from `packages/ui`; app compositions in `apps/web/src/components/<domain>/`.
- Tailwind classes referencing tokens only; no raw hex values, no inline styles except computed sizes.
- Forms: native `<form>` with Server Actions plus progressive enhancement; inline errors from `ActionResult`.
- Loading: skeletons for content, the companion for jobs (§5.14).
- Images: `next/image` with explicit sizes; avatars only from `avatars.githubusercontent.com`.
- No global client state library; use URL state, Server Components and small local state.

### 10.9 Time

Store UTC. Compute member-facing days in the member's timezone with `date-fns-tz`. Never use the server's local time. Pass `now` into pure functions.

### 10.10 Copy

All user-facing strings live in `apps/web/src/copy/<domain>.ts` as typed objects, following §9.8. No strings hardcoded in components (except accessibility-only labels built from copy keys).

### 10.11 Comments and docs

Comments explain why, not what. Public functions get JSDoc. When code changes behavior described in docs, update the docs in the same commit.

### 10.12 Enforced lint rules and checks

- `no-restricted-imports`: block `**/__fixtures__/**` outside test files; block AI SDK package names.
- `import/no-restricted-paths`: the package boundary table (§4.3).
- `jsx-a11y/recommended`, `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`.
- `@typescript-eslint/no-floating-promises`, `no-explicit-any`, `no-non-null-assertion`, `consistent-type-imports`.
- `scripts/check-hardcoded.ts` (in `pnpm verify`): flags numeric literals greater than 1 and string arrays of 3+ items in `packages/core` and `packages/algorithms` unless they are named constants with a comment or marked `// allowed-literal: <reason>`.
- `scripts/check-licenses.ts`: fails on dependencies outside §2.2.
- `scripts/check-contrast.ts`: fails on token pairs below AA.

## 11. Testing and performance

### 11.1 Layers and targets

| Layer | Tools | Coverage target | Focus |
| --- | --- | --- | --- |
| `packages/algorithms` | Vitest | ≥ 95% lines | Edge cases: empty input, single item, ties, NaN guards, bounds, determinism |
| `packages/github`, `packages/sources` | Vitest + MSW | ≥ 85% | Fixtures recorded from real responses, sanitized; 200, 304, 202, 403/429, 404, 5xx paths |
| `packages/db` | Vitest + local Postgres | Key paths | Settings resolution, `take_token`, RLS isolation, ledger constraints |
| `packages/core` | Vitest + local Postgres + MSW | ≥ 80% | Services and job handlers end to end against fixtures |
| `packages/ui` | Testing Library + axe | Every interactive component | Companion SVG snapshots per seed and state |
| `apps/web` | Testing Library | Server actions | Called directly with mocked guards |
| End to end | Playwright + axe | Critical flows (§11.4) | Against the local Supabase stack |

Coverage thresholds are enforced in each package's Vitest config. Never lower a threshold to get green.

### 11.2 Fixtures

- `pnpm fixtures:record <name> <url>` calls the real API with the server token, then runs `sanitize()`: emails → `user@example.com`, tokens and private fields removed, logins replaced with `fixture-user-N` unless the account is a well-known public organization.
- Saved to `packages/<pkg>/src/__fixtures__/<name>.json` and committed.
- Tests never hit the network: MSW runs with `onUnhandledRequest: 'error'`.
- YAKE reference outputs are generated once with the reference implementation on sample texts and committed as fixtures; the TypeScript port must match them within tolerance.

### 11.3 Test database

- `pnpm db:start` runs the local Supabase stack.
- Each integration test file creates a fresh schema (`test_<random>`), runs all migrations (including the settings seed) into it, and drops it afterwards.
- `withSettings({ key: value })` overrides settings for a single test.
- Time is controlled with Vitest fake timers or explicit `now` arguments.

### 11.4 End-to-end flows

1. Landing live demo analyzes a fixture-backed username and shows the Done state and the card.
2. Dev Card page for a non-member renders with `noindex` and no share button.
3. Compatibility Check between two fixture users shows a score and four components.
4. Sign in with GitHub (mocked OAuth in local Supabase) → onboarding → university email code from the local mail catcher → verified → home.
5. Discover → send a message request → second user accepts → a message arrives in real time.
6. Review Exchange: request → claim → verification job against fixtures → helpful rating → balances correct.
7. Streak judgement over two simulated days with one freeze.
8. Account deletion removes data and signs out.

Every e2e page runs an axe scan; any serious or critical violation fails the test.

### 11.5 What `pnpm verify` runs

`lint` → `typecheck` → `check:hardcoded` → `check:licenses` → `check:contrast` → `test` (unit + integration) → `build`.

E2E runs separately (`pnpm test:e2e`) and in CI on pull requests to `main`.

### 11.6 Performance budgets

| Area | Budget |
| --- | --- |
| Landing page | LCP < 2.5s on a mid-range phone; route JS < 150 KB gzipped (excluding fonts) |
| Tool pages | First input interactive < 2s; first progress event < 1.5s after submit |
| Server actions | p95 < 500 ms excluding external API calls |
| Interactive jobs | A typical profile (≤ 100 repos) completes within `jobs.interactiveBudgetMs`, or continues without user-visible interruption |
| Database | No sequential scan on tables over 10k rows in hot paths (checked with `EXPLAIN` in P7) |
| Lighthouse | ≥ 90 for performance, accessibility, best practices and SEO on landing and tool pages |

Prefer Server Component streaming with `Suspense` over client fetching; keep client components small.

## 12. Git and GitHub workflow

Every task ends with a commit and a push. Every phase ends with a pull request, a green CI run, a merge and a tag.

### 12.1 Branches

- `main` is always deployable. The human protects it in P0-T01 (require CI to pass, no force pushes).
- One branch per phase: `phase/0-groundwork`, `phase/1-core`, `phase/2-day-one-tools`, `phase/3-university`, `phase/4-campus-social`, `phase/5-campus-collab`, `phase/6-crowd`, `phase/7-launch`.
- Create it from an up-to-date `main`:

```bash
git switch main && git pull --ff-only && git switch -c phase/<n>-<name>
```

### 12.2 Commit messages

Conventional Commits with the task id:

```text
<type>(<scope>): <imperative summary, at most 72 characters> [P<n>-T<m>]

<body: what changed and why; bullet points are fine>
Spec: CLAUDE.md §8 F7
```

- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `style`, `build`.
- Scopes: package or domain names (`jobs`, `github`, `graveyard`, `ui`, `db`, `auth`, `compat`, …).
- Examples:
  - `feat(graveyard): add revivability scoring with license gating [P2-T13]`
  - `chore(deps): add smol-toml for gitleaks rule parsing [P2-T09]`
  - `docs(claude): split P2-T10 into subtasks [P2-T10]`

### 12.3 After every task

```bash
pnpm verify
git add -A
git status                      # review: no .env, no unsanitized fixtures, no stray files
git commit -m "<message>"
git push -u origin "$(git branch --show-current)"
```

- Push rejected because the remote is ahead → `git pull --rebase`, re-run `pnpm verify`, push again. Never force-push a shared branch.
- Push fails for authentication or network reasons → report it and stop (§13).

### 12.4 End of phase

1. Confirm every task in the phase is ticked and the changelog is current.
2. Open a pull request:

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "Phase <n>: <name>" --body-file .github/pull_request_template.md
```

If the GitHub CLI is not installed or authenticated, post the title and body for the human.

3. Wait for CI. Fix failures with new commits on the phase branch.
4. Merge with a merge commit (keeps per-task history): `gh pr merge --merge`, or ask the human.
5. Tag and push:

```bash
git switch main && git pull --ff-only
git tag phase-<n>-done && git push origin phase-<n>-done
```

6. Create the next phase branch (§12.1).

### 12.5 Never

- Force-push `main` or rewrite pushed history.
- Commit `.env*` files (except `.env.example`), tokens, real personal data, or unsanitized fixtures.
- Disable lint rules, add `.skip` or `.only`, or lower coverage thresholds to get green.
- Push when `pnpm verify` fails, or merge with failing CI.

### 12.6 CI workflow (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  push: { branches: ['**'] }
  pull_request: { branches: [main] }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck
      - run: pnpm check:hardcoded && pnpm check:licenses && pnpm check:contrast
      - name: Start local Supabase for integration tests
        run: npx supabase start
      - run: pnpm db:migrate && pnpm test
      - run: pnpm build
      - name: Secret scan (gitleaks CLI)
        run: |
          url=$(curl -s https://api.github.com/repos/gitleaks/gitleaks/releases/latest \
            | grep browser_download_url | grep linux_x64 | cut -d '"' -f 4)
          curl -sSfL "$url" | tar xz gitleaks
          ./gitleaks detect --source . --no-banner --redact
  e2e:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx supabase start && pnpm db:migrate
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
```

Use the latest major versions of the actions at the time of P0-T06. CI never needs production secrets: tests use the local Supabase stack and recorded fixtures.

### 12.7 Dependabot

`.github/dependabot.yml`: weekly updates for npm (grouped minor and patch) and GitHub Actions. Dependabot PRs target `main`, and must pass CI and `check:licenses` before merging.

## 13. Stop and ask the human

Stop, explain, and ask when any of these is true:

1. The task is marked **\[HUMAN\]**: accounts, OAuth apps, secrets, domains, legal choices, or merges you cannot perform.
2. A required environment variable or secret is missing.
3. A paid service seems necessary, or a license or external policy is unclear.
4. A migration would drop, rename or change the type of a column that holds data. Propose a two-step migration plus an ADR and wait.
5. CI or `pnpm verify` is still red after three honest fix attempts. Never weaken tests to pass.
6. An ambiguity would change product behavior, user privacy, or a rule in §2.
7. A source's policy appears to forbid what a task asks.
8. A spec in this file looks wrong or impossible to implement as written.

**When blocked:**

1. Add `BLOCKED: <task id> — <reason> — <what you need>` as the top line of §17.
2. Commit (`docs(claude): blocked on <topic> [P<n>-T<m>]`) and push.
3. Post a short message to the human with the exact question or steps needed. Stop.

**Instructions for \[HUMAN\] tasks** follow this format:

```text
HUMAN STEP: P<n>-T<m> — <title>
WHY: <one sentence>
DO THIS:
  1. <exact click path or command>
  2. …
THEN GIVE ME: <values to paste, or "tell me when done">
WHERE IT GOES: <env var names / Supabase Vault names / GitHub settings>
```

## 14. Environment and commands

### 14.1 Environment variables

`.env.example` lists every variable; `packages/env` validates them with zod at startup and fails fast with a clear message.

| Variable | Scope | Needed in | Purpose / how to get it |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | client | all | Base URL (`http://localhost:3000` locally) |
| `NEXT_PUBLIC_SITE_NAME` | client | all | Display name (`CommitMates`) |
| `NEXT_PUBLIC_SUPABASE_URL` | client | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client | all | Publishable key (older projects call it the anon key) |
| `SUPABASE_SECRET_KEY` | server | all | Secret key (older: service\_role). Server only |
| `DATABASE_URL` | server | all | Pooled (transaction pooler) connection; used with `prepare: false` |
| `DIRECT_DATABASE_URL` | server | all | Direct or session connection, for migrations |
| `GITHUB_SERVER_TOKEN` | server | all | Fine-grained personal access token with public read-only access, created by the human |
| `TOKEN_ENCRYPTION_KEY` | server | all | `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY_VERSION` | server | all | Integer, starts at 1 |
| `TOKEN_ENCRYPTION_KEY_PREV` | server | rotation only | Previous key during rotation |
| `OTP_PEPPER` | server | all | `openssl rand -base64 32` |
| `JOB_TICK_SECRET` | server | all | `openssl rand -hex 32`; also stored in Supabase Vault as `tick_secret` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | server | staging, prod | From the free transactional email provider (P3-T02). Locally, the Supabase CLI mail catcher |
| `EMAIL_FROM` | server | all | e.g. `CommitMates <no-reply@yourdomain>` |
| `CONTACT_EMAIL` | server | all | Appended to User-Agents for sources |
| `GEOCODER_BASE_URL` | server | all | Nominatim endpoint; switchable without a code change |
| `GEOCODER_USER_AGENT` | server | all | `CommitMates/1.0 (+<site URL>; <contact email>)` |
| `BOOTSTRAP_ADMIN_GITHUB_ID` | server | all | Numeric GitHub id of the first admin |
| `SENTRY_DSN` | server, client | optional | Enables Sentry when set |
| `LOG_LEVEL` | server | optional | Default `info` |

### 14.2 Commands (root `package.json`)

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs web (`next dev`) and the worker loop in parallel |
| `pnpm db:start` / `pnpm db:stop` | Start or stop the local Supabase stack (Docker) |
| `pnpm db:generate` | Generate a migration from schema changes (drizzle-kit) |
| `pnpm db:migrate` | Apply migrations to `DIRECT_DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:backup` | `pg_dump` to `./backups/<timestamp>.sql.gz` (runbook in P7) |
| `pnpm jobs:dev` | Worker loop only |
| `pnpm jobs:tick` | Run a single tick (debugging) |
| `pnpm fixtures:record <name> <url>` | Record and sanitize an API fixture |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | As named (Turborepo pipelines) |
| `pnpm check:hardcoded` | Flags unexplained literals in core and algorithms |
| `pnpm check:licenses` | Fails on dependencies outside §2.2 |
| `pnpm check:contrast` | Verifies WCAG AA for all token pairs |
| `pnpm test:e2e` | Playwright |
| `pnpm verify` | lint → typecheck → check:hardcoded → check:licenses → check:contrast → test → build |

## 15. Templates, Definition of Done, glossary

### 15.1 ADR template (`docs/decisions/ADR-NNN-title.md`)

```markdown
# ADR-NNN: <title>
Date: YYYY-MM-DD · Status: accepted | superseded by ADR-XXX

## Context
## Decision
## Alternatives considered
## Consequences
## Verification
Licenses checked, current free-tier terms checked on <date>, links to the pages read.
```

### 15.2 Pull request template (`.github/pull_request_template.md`)

```markdown
## Phase <n>: <name>

### Tasks completed
- [x] P<n>-T01 …

### Schema changes
### New settings keys
### New external sources
### Screenshots (UI phases)

### Checklist
- [ ] pnpm verify green
- [ ] e2e green
- [ ] Maintained docs updated (ALGORITHMS, DATA_SOURCES, PRIVACY, ADRs)
- [ ] No secrets or personal data in the diff
```

### 15.3 Runbook template (`docs/runbooks/<name>.md`)

```markdown
# <Runbook name>
When to use: …
Prerequisites: …
## Steps
1. …
## Verify it worked
## Roll back
```

### 15.4 Definition of Done (every task)

- [ ] Behavior matches the task's acceptance criteria in §16 and the referenced spec sections.
- [ ] No hardcoded domain data or unexplained numbers; new numbers are settings keys in the seed migration and §5.5.1.
- [ ] Inputs validated with zod; errors typed and mapped to friendly messages.
- [ ] External calls go through the clients with timeouts, caching, budgets and policy compliance.
- [ ] Tests at the right layers; coverage thresholds hold; no network in tests.
- [ ] UI follows §9: tokens, companion states, accessibility, 360px mobile, reduced motion.
- [ ] Privacy rules respected: non-member handling, owner-only findings, no personal data in logs.
- [ ] Maintained docs updated where relevant.
- [ ] `pnpm verify` green; committed with the right message; pushed.
- [ ] Task ticked in §16 and a line added to §17.

### 15.5 Glossary

| Term | Meaning |
| --- | --- |
| Member | A signed-in user with a CommitMates account |
| Verified member | A member whose university affiliation is verified (email code or vouching) |
| Non-member | Any GitHub user who has not signed up |
| Day-one / Foundation / Campus / Crowd | Unlock tiers (§1.4) |
| Unlock card | The component shown instead of a locked feature, with progress toward unlocking |
| Commitling | A procedurally generated pixel companion (§9.5) |
| Tick | One run of the job runner within a time budget |
| Identity | Which GitHub token a call uses: `user` or `server` |
| Settings Engine | Database-backed configuration with defaults, computed values and overrides (§5.5) |
| Taxonomy expansion | Topics and dependencies learned for a search term (F6) |
| Facet | A feature of a repository used by Gap Finder: a path, a dependency tag, or metadata (F5) |
| Revivability | How worth reviving an inactive repository is (F7) |
| Least-share ratio | Smallest contributor share divided by an equal share (F4) |
| Skill vector | A member's weighted tags from languages and dependencies, TF-IDF weighted within the university (F11) |
| Trust multiplier | Scales a member's daily new-chat limit by their trust score (F12) |
| Escrow | A review credit held from the author until the review is settled (F15) |
| Swap cycle | A 2- or 3-person loop where each teaches what the next wants (F16) |
| Country index | Crawled public developers and repos of a country (F18) |

## 16. Roadmap

Eight phases, done strictly in order. Work on the first unchecked task only. Each task lists the spec sections to read, what to build, and when it counts as done. Split large tasks into subtasks here (P2-T07a, P2-T07b) when needed.

### Phase 0 — Groundwork

Branch `phase/0-groundwork`. Goal: an empty but production-grade monorepo with CI, checks and docs.

- [x] **P0-T01 \[HUMAN\] Repository and protection.** Spec: §12.1.
  - Human: create the GitHub repository (public is recommended for free CI minutes), add it as `origin`, choose a license (default MIT), and after the first push protect `main` (require CI, block force pushes).
  - Claude: add `.gitignore`, `.editorconfig`, `.nvmrc` (current Node LTS), `LICENSE`, a `README.md` stub (what it is, how to run, link to this file), and this `CLAUDE.md`.
  - Done when: the first commit is on `origin/main` and the `phase/0-groundwork` branch exists.
- [x] **P0-T02 Monorepo tooling.** Spec: §3, §4, §10.1.
  - pnpm workspace, `turbo.json` pipelines (`lint`, `typecheck`, `test`, `build`, with caching), root scripts from §14.2.
  - `packages/config`: strict tsconfig base, ESLint flat config (rules from §10.12 including boundary rules), Prettier, Vitest preset.
  - Done when: `pnpm verify` runs green on the empty workspace.
- [x] **P0-T03 Package skeletons.** Spec: §4.1–4.3.
  - Every package and `apps/worker` with `src/index.ts`, a README (purpose, public API, allowed imports), and one sample test.
  - Done when: build and tests pass; an illegal cross-package import fails lint (tested).
- [x] **P0-T04 Web app shell.** Spec: §4.1.
  - Next.js in `apps/web` with Tailwind, base layout, `/health` page and a route returning version and server time.
  - Done when: the app renders and builds.
- [x] **P0-T05 Testing infrastructure.** Spec: §11.
  - Vitest workspace config, Testing Library, MSW helpers, Playwright config with a smoke test on `/health`, an axe helper.
  - Done when: `pnpm test` and `pnpm test:e2e` pass locally.
- [x] **P0-T06 Local infrastructure and environment.** Spec: §5.2, §14.1.
  - `supabase/config.toml` (GitHub provider placeholders, mail catcher), `pnpm db:start` / `db:stop`.
  - `packages/env` zod schemas (server, client, worker) and `.env.example`.
  - Done when: starting the app without required variables fails with a clear list of what's missing; with `.env.local` it runs.
- [x] **P0-T07 Quality scripts.** Spec: §10.12.
  - `scripts/check-hardcoded.ts`, `scripts/check-licenses.ts`, `scripts/check-contrast.ts` (reads token files when they exist), wired into `pnpm verify`.
  - Done when: each script has tests and a deliberate violation fails it.
- [x] **P0-T08 CI and repository hygiene.** Spec: §12.6, §12.7, §15.2.
  - `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `.gitleaks.toml`.
  - Done when: CI is green on push.
- [x] **P0-T09 Maintained docs scaffold.** Spec: §0.2, §15.1.
  - `docs/ALGORITHMS.md`, `docs/DATA_SOURCES.md`, `docs/PRIVACY.md`, `docs/runbooks/README.md`, `docs/decisions/ADR-001-stack.md` (every tool's license and current free-tier terms, checked with dates and links).
  - Done when: files exist with headings and ADR-001 is complete.

### Phase 1 — Core platform

Branch `phase/1-core`. Goal: database, settings, jobs, GitHub client, auth, design system and admin basics.

- [x] **P1-T01 Schema v1 and RLS baseline.** Spec: §5.4, §5.5, §5.6, §5.10, §7.1, §7.4, §7.5.
  - Tables: identity group, `settings`, `settings_history`, `jobs`, `job_schedules`, `api_cache`, `github_budgets`, `rate_limit_buckets`, `metric_samples`, `salts`, `geocode_cache`, `geocoder_lock`, `source_snapshots`, `audit_log`, `notifications`, `notification_prefs`, `feedback`, `tool_sessions`, `roles`.
  - `take_token` function, `updated_at` triggers, RLS enabled everywhere, policies only where §5.9 says.
  - Done when: migrations apply on a fresh database; a test proves `anon` and `authenticated` can't read platform tables.
- [x] **P1-T02 Settings engine.** Spec: §5.5.
  - Key registry, `getSetting`, `setComputed`, `setOverride`, zod schemas for JSON keys, in-memory cache.
  - Seed migration containing every key in §5.5.1.
  - Recompute framework: a registry mapping computed keys to functions, run by `recompute_settings`.
  - Done when: resolution tests pass; a test asserts the registry and seed contain exactly the same keys.
- [x] **P1-T03 Job system.** Spec: §5.3, §5.4.
  - Queue, claim, runner rules, reaper, schedules (a permissive-licensed cron parser), priorities, `enqueue` with idempotency.
  - `/api/jobs/tick` (constant-time secret check), `apps/worker` loop, `after()` helper, SSE endpoint following continuations.
  - Done when: a concurrency test with two workers shows no double processing; retry, wait, continue and dead paths are tested.
- [x] **P1-T04 GitHub client.** Spec: §5.6.
  - Identities, Octokit with throttling and retry, ETag cache, budgets, search pacer, 202 handling, error classes, zod parsing, `parseGitHubUrl`, GraphQL helper selecting `rateLimit`.
  - Done when: MSW tests cover 200, 304, 202, 401, 403/429 with and without `retry-after`, 404, 422, 5xx.
- [x] **P1-T05 Crypto and rate limiting.** Spec: §5.10.
  - `encrypt`/`decrypt` with key versions, OTP helpers, `guardRate`, IP hashing with a daily salt, `cleanup_rate_buckets` and `rotate_salts` jobs.
  - Done when: tests cover round trips, rotation, bucket refill and exhaustion.
- [x] **P1-T06 \[HUMAN\] GitHub OAuth app for local development.** Spec: §5.2.
  - Human: create a GitHub OAuth app with callback `http://localhost:54321/auth/v1/callback` (or the local Supabase URL), put the client id and secret in local Supabase config, and create the fine-grained `GITHUB_SERVER_TOKEN` (public read-only).
  - Claude: write `docs/runbooks/github-oauth.md` with exact steps for dev, staging and prod.
- [x] **P1-T07 Authentication.** Spec: §5.11, §8 F10 step 1.
  - Sign in with GitHub (scopes `read:user user:email`), callback capturing the provider token (encrypted into `github_identities`), upsert `users` and `profiles`, bootstrap admin, middleware session refresh, guards, sign-out.
  - Done when: e2e sign-in works against local Supabase and the stored token is encrypted.
- [x] **P1-T08 Design tokens and base components.** Spec: §9.2–9.4.
  - `tokens.css`, Tailwind mapping, fonts, Material Symbols subset, theme toggle (system default, persisted).
  - Components from §9.4 except `CompanionView` and charts.
  - Done when: `check:contrast` passes and every interactive component passes axe in tests.
- [ ] **P1-T09 Linguist sync and companion engine.** Spec: §6.3, §9.5.
  - Source framework basics (§5.7) and `sync_linguist` (languages and path patterns compiled with RE2).
  - Companion generator, five state animations, `CompanionView`, `SpeechBubble`, reduced motion.
  - Done when: snapshot tests for fixed seeds and states pass; the same seed always produces the same SVG.
  - [x] **P1-T09a Source framework and Linguist sync.** `SourceModule` contract, `runSourceSync` with `source_snapshots`, `languages` and `path_patterns` tables, `sync_linguist` job and weekly schedule.
  - [ ] **P1-T09b Companion engine.** Generator, sprite sheet, `CompanionView`, `SpeechBubble`, reduced motion, snapshot tests.
- [ ] **P1-T10 App shell and landing skeleton.** Spec: §9.6, §9.8.
  - Navbar, footer, route groups, 404 and 500 pages, theme toggle placement.
  - Landing sections with real copy (live demo wired in P2).
  - First versions of `/privacy`, `/terms` and `/attribution` written from §5.12 and §6.11 (finalized in P7).
  - Done when: Lighthouse accessibility ≥ 90 on the landing page.
- [ ] **P1-T11 Observability and admin base.** Spec: §5.11, §5.13.
  - pino logger with request and job ids, `withAction` wrapper, error boundaries, optional Sentry.
  - `/admin/health`, `/admin/jobs` (queue, dead jobs, schedules toggle), `/admin/settings` (values, history, override), audit-log writes.
  - Done when: admin pages require the admin role (tested) and show live data.

### Phase 2 — Day-one tools (the data engine)

Branch `phase/2-day-one-tools`. Goal: all eight public tools working on live data, each one feeding anonymous aggregates.

- [ ] **P2-T01 Source runner and explore topics.** Spec: §5.7, §6.2.
  - Generic sync runner with `source_snapshots`; `sync_explore` into `topics`; weekly schedules; admin source status panel.
  - Done when: a fixture-based sync inserts, updates and skips correctly; a failed fetch keeps old data.
- [ ] **P2-T02 Manifest parsers.** Spec: §6.6.
  - Pure parsers for `package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `setup.cfg`, `pubspec.yaml`, `Cargo.toml`, `go.mod`, `composer.json`, `Gemfile`, `pom.xml`, `build.gradle(.kts)`.
  - Done when: each parser passes tests on real-world fixtures, including malformed files.
- [ ] **P2-T03 Registry enrichment.** Spec: §6.6.
  - npm, PyPI, crates.io, pub.dev, Packagist modules; GitHub-topics fallback; derived tag normalization through topic aliases; `enrich_packages` job with per-registry pacing.
  - Done when: fixtures for each registry produce expected derived tags; pacing is enforced in tests.
- [ ] **P2-T04 Profile ingestion.** Spec: §8 F1 "Data fetched", §5.12.
  - GraphQL queries, events fetch, upserts into `gh_users`, `gh_repos`, `repo_manifests`, `repo_dependencies`.
  - `purge_non_user_raw` job; `metric_samples` writer with salted dedupe.
  - Done when: a fixture profile ingests completely; purge removes non-member rows after the TTL.
- [ ] **P2-T05 Geocoding and timezones.** Spec: §6.8, §6.9, §8 F18 "Geocoding".
  - Geocoder module with the global lock, pending queue, `geocode_pending` job, coordinates-to-timezone lookup, non-place handling.
  - Done when: concurrent ticks never call Nominatim faster than `geocoder.minIntervalMs` (tested with fake timers).
- [ ] **P2-T06 Tool page framework.** Spec: §5.3, §5.14, §9.6.
  - Shared tool page template, `useJob` hook (EventSource), companion state mapping, `/api/tools/[tool]` routing with rate limits and caching, `tool_sessions` writes.
  - Done when: a test tool runs end to end with progress events and all five states.
- [ ] **P2-T07 Dev Card.** Spec: §8 F1, §9.4–9.6.
  - Pure metric and label functions, `analyze_profile` handler, card UI, `/tools/dev-card`, `/u/[login]` for members with visibility, `noindex` for non-members.
  - Done when: F1's tests pass and the e2e flow 2 (§11.4) passes.
- [ ] **P2-T08 Share images.** Spec: §9.7.
  - `/api/og/dev-card` for members; share buttons that appear only when allowed.
  - Done when: images render for members and return 404 for non-members.
- [ ] **P2-T09 Compatibility Check.** Spec: §8 F2.
  - Components, weights, bands, explanations, `compat_check` job, page, share rules, OG image.
  - Done when: F2's tests and e2e flow 3 pass.
- [ ] **P2-T10 Secret rules and scanner.** Spec: §6.7, §8 F3 "Secret scan".
  - `sync_gitleaks` into `secret_rules` (RE2 compile, skipped count), scanner over repo trees with caps.
  - Done when: fixtures with planted fake secrets are found; stored findings never contain the value.
- [ ] **P2-T11 Recruiter-Ready Score.** Spec: §8 F3.
  - Rules engine with partial credit, `generic_message_counts` table, owner-only secret panel, checklist UI.
  - Done when: F3's tests pass; owner-only access is enforced.
- [ ] **P2-T12 Group Fairness Report.** Spec: §8 F4.
  - Stats with 202 retries, vendored and generated exclusion, co-author parsing, Gini and least-share, identity merge in the browser, timeline chart.
  - Done when: F4's tests pass, including the more-than-10,000-commits fallback.
- [ ] **P2-T13 Taxonomy engine.** Spec: §8 F6.
  - `topic_global_counts`, `taxonomy_expansions`, scoring, caching, `taxonomy_expand` job.
  - Done when: F6's tests pass.
- [ ] **P2-T14 Project Graveyard (global).** Spec: §8 F7.
  - Global search pipeline, unfinished and finished signals, revivability, difficulty labels, license gating, adoption links, locked uni and country tabs with Unlock cards.
  - Done when: F7's tests pass for the global scope.
- [ ] **P2-T15 Gap Finder (day-one).** Spec: §8 F5.
  - `repo_paths`, `gap_reports`, facet extraction, peer search, prevalence, label resolution, campus panel as an Unlock card.
  - Done when: F5's tests (except the campus query) pass.
- [ ] **P2-T16 Open-Source Starter (global).** Spec: §8 F8.
  - Issue search, label discovery, responsiveness metric, gates with relaxation, ranking, UI.
  - Done when: F8's tests pass.
- [ ] **P2-T17 Stopwords, YAKE and BM25.** Spec: §8 F9 step 1, step 3.
  - Stopword source module (open dataset, snapshot), YAKE port, BM25, reference fixtures generated once from the reference YAKE implementation.
  - Done when: outputs match the reference fixtures within tolerance.
- [ ] **P2-T18 FYP Idea Checker (global).** Spec: §8 F9.
  - `fyp_check` job, similarity bands, explanations, UI.
  - Done when: F9's tests pass.
- [ ] **P2-T19 Landing live demo and SEO.** Spec: §9.6.
  - Terminal demo running a real Dev Card job, five-state strip, tools grid, FAQ, metadata, sitemap (public pages only), robots rules.
  - Done when: e2e flow 1 passes and Lighthouse targets (§11.6) are met on the landing page.
- [ ] **P2-T20 Recompute jobs and metrics.** Spec: §5.5, §1.7.
  - Recompute functions for every computed key in §5.5.1 that phase 2 feeds; `/admin/metrics` with tool usage and conversion.
  - Done when: a test seeds samples above `min_sample` and the nightly job writes computed values with history.

### Phase 3 — University layer

Branch `phase/3-university`. Goal: verified university membership, onboarding, university pages, privacy controls.

- [ ] **P3-T01 University and disposable-domain sources.** Spec: §6.4, §6.5.
  - `sync_hipo` (diff upsert, slugs, `source_missing`), `sync_disposable_emails` (choose the list and record its license in an ADR), suffix-matching helper.
  - Done when: fixture syncs work and suffix matching passes boundary tests.
- [ ] **P3-T02 \[HUMAN\] Transactional email provider.** Spec: §3.2, §14.1.
  - Human: create a free account with a transactional email provider, verify a sending domain or address, and provide SMTP settings.
  - Claude: ADR with the provider's current free-tier terms; set `email.maxPerDay` below the daily quota.
- [ ] **P3-T03 Email package.** Spec: §4.1, §9.8.
  - Transport, templates (verification code, notification digest, account notices) in plain text and simple HTML, daily cap tracking with queueing beyond the cap.
  - Done when: templates render in tests and sends above the cap are deferred.
- [ ] **P3-T04 Email verification.** Spec: §8 F10 steps 2–4.
  - `startEmailVerification`, `send_otp`, `confirmEmailCode`, onboarding verification UI.
  - Done when: e2e flow 4 passes with the local mail catcher; OTP limits are tested.
- [ ] **P3-T05 Pending universities, vouching, moderators.** Spec: §8 F10 steps 5–6, §5.11.
  - `university_requests` flow, `/admin/universities`, vouch actions and rules, `uni_moderator` role management.
  - Done when: approval and vouching paths are tested end to end.
- [ ] **P3-T06 Onboarding details.** Spec: §8 F10 step 7.
  - Role, graduation year, departments with trigram dedupe, learning goals from the tag vocabulary, visibility, notification preferences, `profiles.share_today_status`.
  - Done when: onboarding completes and the `(app)` middleware lets verified members in.
- [ ] **P3-T07 University pages and home.** Spec: §1.4, §9.6.
  - `/uni/[slug]` (member count, aggregate top tags, Unlock cards for every campus feature), invite links with `?ref=`, `invites` table, member `/home`.
  - Done when: unlock progress reads thresholds from settings (tested by changing a setting).
- [ ] **P3-T08 Privacy center.** Spec: §5.12.
  - `/settings/privacy`: visibility, ghost mode, JSON export, account deletion flow with typed confirmation.
  - Done when: e2e flow 8 passes and export contains every class A and B table.
- [ ] **P3-T09 Moderation base.** Spec: §5.11, §8 F12 "Moderation queue".
  - Roles admin UI, audit log viewer, the moderation queue page (reports arrive in P4).
  - Done when: role-scoped access is tested for admins and moderators.

### Phase 4 — Campus social

Branch `phase/4-campus-social`. Goal: matching, safe realtime chat, notifications, and shared streaks.

- [ ] **P4-T01 Social and streak schema.** Spec: §5.9, §7.6, §7.7.
  - Social and streak tables, RLS policies from §5.9, Realtime publication for `messages`, `thread_members` and `notifications`.
  - Done when: two-user RLS isolation tests pass.
- [ ] **P4-T02 Skill vectors.** Spec: §8 F11 "Vectors".
  - `compute_skill_vector` (TF-IDF within the university), interest sets, wants from learning goals; weekly refresh schedule.
  - Done when: TF-IDF weighting is tested against a hand-computed fixture.
- [ ] **P4-T03 Matching engine.** Spec: §8 F11 "Scoring", "Deck", "Explanations".
  - Pair scoring for the three modes, `match_daily` with exposure cap and seeded fairness ordering, exclusion rules, explanation keys.
  - Done when: F11's scoring, cap and exclusion tests pass.
- [ ] **P4-T04 Discover UI.** Spec: §8 F11 "UI", §9.4 `DeckCard`.
  - Deck with keyboard shortcuts, mode tabs, filters, like/skip/request actions, cold-start Unlock card and view-only "developers like you" list.
  - Done when: deck actions persist and keyboard use passes axe and manual checks.
- [ ] **P4-T05 Message requests and chat.** Spec: §8 F12 "Message requests", "Messages", "Realtime".
  - Actions, request rules, threads, Realtime subscription, unread counts, icebreaker templates filled from real shared signals, edit window.
  - Done when: e2e flow 5 passes.
- [ ] **P4-T06 Trust and safety.** Spec: §8 F12 "Trust score", "Reports and auto-hide", "Moderation queue".
  - `compute_trust`, trust-based limits, link caps, block, report, auto-hide, moderation actions with audit.
  - Done when: auto-hide counts only distinct verified reporters; every moderation action is audited (tested).
- [ ] **P4-T07 Notifications.** Spec: §7.5, §8 F12.
  - In-app notification center via Realtime, `digest_email` per timezone batch, preferences, email cap respected.
  - Done when: digests batch correctly and respect mutes and caps.
- [ ] **P4-T08 Shared streaks.** Spec: §8 F13 "Pairing", "Daily judgement".
  - Pair invites, `streak_check` with timezone-correct judgement, freezes, pause, token-invalid skip.
  - Done when: e2e flow 7 and F13's timing tests pass.
- [ ] **P4-T09 Pair companion and streaks page.** Spec: §8 F13 "UI", §9.5.
  - Two-tone pair companion, stages and moods, 30-day strip, partner status (respecting `share_today_status`), share card.
  - Done when: stage and mood transitions render correctly in snapshot tests.
- [ ] **P4-T10 Match weight tuning and social metrics.** Spec: §8 F11 "Weight tuning", §1.7.
  - `tune_match_weights`, match-quality and streak-retention metrics on `/admin/metrics`.
  - Done when: tuning respects the step and minimum-success rules (tested).

### Phase 5 — Campus collaboration

Branch `phase/5-campus-collab`. Goal: adoptions, verified reviews, skill swaps, campus layers of day-one tools, and Senior's Legacy.

- [ ] **P5-T01 Collaboration schema.** Spec: §7.8.
  - Listings, suggestions, adoptions, review tables, `credit_ledger` (append-only grants), `ledger_locks`, swap tables, `legacy_entries`, `oss_member_contribs`.
  - Done when: migrations apply and the ledger rejects updates and deletes.
- [ ] **P5-T02 Uni listings and adoptions.** Spec: §8 F14, §8 F7 (uni scope).
  - `suggest_listings`, listing management in `/settings/projects`, adoption flow, uni tab of the Graveyard enabled.
  - Done when: suggestions stay private to the owner; the adoption flow works end to end.
- [ ] **P5-T03 Revival tracking and badges.** Spec: §8 F14 "Revival tracking".
  - `track_revivals`, revived and dropped transitions, "Revived" badges and companion `reviver` trait.
  - Done when: commit counting with `since` is tested against fixtures.
- [ ] **P5-T04 Credit ledger.** Spec: §8 F15 "Credits".
  - Ledger service with locked transactions, starter credits on verification, balance view.
  - Done when: a parallel test of 50 concurrent escrows never produces a negative balance.
- [ ] **P5-T05 Review Exchange.** Spec: §8 F15.
  - Request validation, language detection, claims, `verify_review`, rating and settlement, auto-settle, expiry, disputes, reputation, `/reviews` UI.
  - Done when: e2e flow 6 passes.
- [ ] **P5-T06 Verified Skill Swap.** Spec: §8 F16.
  - Offers from skill percentiles, self-declared offers, wants, `propose_swaps` (2- and 3-cycles), acceptance flow, group threads.
  - Done when: F16's graph tests pass.
- [ ] **P5-T07 Gap Finder campus layer.** Spec: §8 F5 step 7.
  - Member lookup by tag percentile within the university, Ask buttons opening message requests with context.
  - Done when: the query respects visibility, blocks and ghost mode (tested).
- [ ] **P5-T08 Open-Source Starter campus layer.** Spec: §8 F8 step 5.
  - Weekly paced search of members' merged PRs into `oss_member_contribs`; "seniors contributed here" panel.
  - Done when: the panel shows only verified members of the viewer's university.
- [ ] **P5-T09 Senior's Legacy.** Spec: §8 F17.
  - Showcase entries, `legacy_refresh`, search with taxonomy expansion, filters, Ask routing, `/legacy` UI.
  - Done when: F17's tests pass.
- [ ] **P5-T10 Member profile pages.** Spec: §8 F1, §9.5.
  - `/u/[login]`: companion with traits, labels, badges (reviewer, reviver, streak, OSS), revived projects, review reputation, showcase entries, visibility rules.
  - Done when: each visibility level is tested (university, country, public, hidden).

### Phase 6 — Crowd features

Branch `phase/6-crowd`. Goal: the country index, leaderboards, alumni, squads and the FYP board.

- [ ] **P6-T01 Crowd schema.** Spec: §7.9.
  - Crawl, leaderboard, alumni, events, squads and FYP tables with RLS.
  - Done when: migrations apply cleanly.
- [ ] **P6-T02 Country crawler and opt-out.** Spec: §8 F18.
  - Dynamic seeds, `crawl_country` with recursive date-range splitting, minimal storage, repo metadata fetch, storage guard and pruning, refresh, `/optout` page, `/admin/crawler`.
  - Done when: F18's tests pass and opted-out logins are never stored.
- [ ] **P6-T03 Graveyard country scope.** Spec: §8 F7 (country).
  - Full-text and topic search over the country index; country tab enabled.
  - Done when: country results use the same scoring and labels as global (tested).
- [ ] **P6-T04 Leaderboards.** Spec: §8 F19.
  - `leaderboard_weekly`, per-capita metrics, department boards, individual opt-in, `/leaderboards` UI.
  - Done when: F19's tests pass.
- [ ] **P6-T05 Alumni Quick Asks.** Spec: §8 F20.
  - `role_transition`, question tagging, routing score, `alumni_route` and `alumni_sla`, anonymous asking, `/alumni` UI.
  - Done when: F20's tests pass.
- [ ] **P6-T06 Squad Builder.** Spec: §8 F21.
  - Events, participation with availability, locked groups, k-means with silhouette selection, greedy formation, swap requests, finalization, squad threads.
  - Done when: F21's tests pass with a fixed seed.
- [ ] **P6-T07 FYP Board.** Spec: §8 F22, §8 F9 step 6.
  - Supervisor applications and approvals, ideas with duplicate checks, interest and team formation, past projects (submission and detection), uni-first switch in F9.
  - Done when: F22's tests pass.
- [ ] **P6-T08 Country-aware discovery.** Spec: §8 F11 "UI".
  - Discover's cold-start "developers like you" list switches from live GitHub search to the country index when available (view-only, no chat with non-members).
  - Done when: the switch is tested and non-members are never contactable.

### Phase 7 — Hardening and launch

Branch `phase/7-launch`. Goal: secure, fast, accessible, documented, deployed.

- [ ] **P7-T01 Security review.** Spec: §5.10.
  - Walk the threat model; CSP with nonces; RLS audit of every table; input validation audit of every action and route; dependency audit; `docs/runbooks/rotate-token-key.md`.
  - Done when: findings are fixed and recorded in an ADR.
- [ ] **P7-T02 Performance.** Spec: §11.6.
  - `EXPLAIN` hot queries and add indexes, caching and ISR for public pages, bundle analysis, image audit.
  - Done when: every budget in §11.6 is met and recorded.
- [ ] **P7-T03 Accessibility audit.** Spec: §9.10.
  - Full axe pass across all pages in Playwright, keyboard walkthrough, screen-reader labels for companions and charts.
  - Done when: no serious or critical violations remain.
- [ ] **P7-T04 Legal and attribution.** Spec: §5.12, §6.11.
  - Final privacy policy matching actual data use, terms, `/attribution` generated from sources and dependency licenses.
  - Done when: every source and asset in use is credited.
- [ ] **P7-T05 \[HUMAN\] Backups and monitoring.** Spec: §5.13, §15.3.
  - Human: set up a free uptime monitor for the site and `/health`.
  - Claude: `scripts/db-backup.sh`, `pnpm db:backup`, `docs/runbooks/backup-restore.md` including a restore drill against a scratch database.
  - Done when: a restore drill has been performed and documented.
- [ ] **P7-T06 \[HUMAN\] Staging and production deployment.** Spec: §5.2, §5.4 "Production trigger".
  - Human: create the Vercel project, two Supabase projects (staging, prod), staging and prod GitHub OAuth apps, Vault secrets `tick_url` and `tick_secret`, and environment variables.
  - Claude: `docs/runbooks/deploy.md`; apply migrations to staging then prod; enable the pg\_cron tick migration; verify schedules.
  - Done when: staging and prod both serve the app and process ticks.
- [ ] **P7-T07 Production verification.** Spec: §11.4, §5.13.
  - Run e2e against staging; check `/admin/health` (budgets, queue, sources, email); verify a real day-one tool run and a real email code on staging.
  - Done when: all checks pass and results are recorded in the changelog.
- [ ] **P7-T08 Launch kit.** Spec: §1, §2.4.
  - Final `README.md`, `CONTRIBUTING.md`, feedback form, launch checklist in `docs/runbooks/launch.md`; scan for any fake or placeholder content; tag `v1.0.0`.
  - Done when: the launch checklist is complete and `v1.0.0` is pushed.

## 17. Changelog

Newest first, one line per completed task or subtask: `YYYY-MM-DD — <task id> — <what was done>`. A `BLOCKED:` line, when present, is always the first line (§13). Spec fixes made under §0.9 are logged here too.

- 2026-10-14 — P1-T09a — Source framework (SourceModule contract, runSourceSync with source_snapshots, last good data kept on failure, empty results refused) and the Linguist source: languages and path_patterns tables, YAML parsing, RE2 compilation with re2js (uncompilable patterns stored and counted, not used), path matcher, sync_linguist job with a weekly schedule. Fixtures are the real vendor.yml and documentation.yml and an excerpt of languages.yml.
- 2026-10-14 — P1-T08 — Design tokens (dark and light), Tailwind 4 mapping and typography roles, self-hosted Inter / Pixelify Sans / JetBrains Mono via next/font, generated Material Symbols subset (25 icons), theme toggle (system default, persisted, no flash), and base components: Button, Field, Input, Textarea, Select, Combobox, Card, Chip, StateChip, TerminalWindow, UnlockCard, ChecklistRule, Tabs, Dialog, Accordion, Toast, Tooltip, Popover, DropdownMenu, Skeleton, EmptyState, Avatar, Icon. 34 component tests with axe; e2e checks both themes in a real browser. Spec fix (§9.2): light --accent, --state-working and --state-done darkened to #177A30, #8F5A00 and #136F35 because the original values failed the WCAG AA rule the same section requires (ADR-003). Dependabot now ignores TypeScript, ESLint and MSW majors.
- 2026-10-14 — P1-T07 — Authentication: GitHub sign-in through Supabase Auth (scopes read:user user:email), callback that stores the provider token AES-256-GCM encrypted and upserts users/profiles, bootstrap admin with audit entry, session-refreshing proxy that gates the members area, requireUser/requireVerified/requireRole guards, origin-checked POST sign-out. Verified by integration tests (token stored encrypted) and e2e against local Supabase. The e2e session is created with the Supabase admin API because GitHub's consent screen cannot run in CI; the real browser round-trip through GitHub is unverified until the OAuth app exists (docs/HUMAN_TODO.md). CI now runs e2e on phase branches too.
- 2026-10-14 — P1-T06 — Claude part done: docs/runbooks/github-oauth.md (OAuth apps for local, staging and prod, the fine-grained server token, bootstrap admin). HUMAN part still open and listed in docs/HUMAN_TODO.md: create the local OAuth app and GITHUB_SERVER_TOKEN.
- 2026-10-14 — P1-T05 — OTP helpers (hashed with pepper, constant-time compare), guardRate over take_token with retry hints, hashIp with a daily salt, hashSubject with an aggregate salt, rotate_salts and cleanup_rate_buckets jobs with daily schedules, web guardToolRate/guardWriteRate. Spec fix (§7.4): salts gains a kind column and pk (kind, period), because the daily IP salt and the 30-day aggregate salt have different lifetimes and would collide on period alone.
- 2026-10-14 — P1-T04 — GitHub client: two token identities, @octokit/core transport, ETag cache, budgets from headers and /rate_limit with reserves, row-locked search pacer, secondary-limit handling, 202 stats retries, typed errors, zod parsing, GraphQL helper requiring rateLimit, parseGitHubUrl; AES-256-GCM token encryption with key versions. MSW tests cover 200, 304, 202, 401, 403/429 with and without retry-after, 404, 422, 5xx. Spec deviations recorded in ADR-002: Octokit throttling/retry plugins not used (limits are coordinated in Postgres), MSW pinned to 2.x, search responses not ETag-cached.
- 2026-10-14 — P1-T03 — Job system: enqueue with idempotency, SKIP LOCKED claim, runner (reaper, schedules, done/continue/wait, backoff with jitter, rate-limit waits, failed/dead), cron schedules (cron-parser, MIT), watchJob event stream following continuations, /api/jobs/tick (constant-time secret), SSE route, after() helper, worker loop and jobs:tick. First handler and schedule: recompute_settings. JobContext carries no github factory: packages/jobs may not import packages/github, so handlers call githubFor() directly. pino logger with redaction lives in packages/db so every server package can use it.
- 2026-10-14 — P1-T02 — Settings Engine: typed key registry (160 keys), getSetting with a table snapshot bounded by settings.cacheMs, setComputed (history above settings.historyMinDelta), setOverride (history + audit log), zod schemas for JSON keys, seed migration, recompute registry with metricPercentile, withSettings test helper, AppError hierarchy. 20 keys named in §8 as new were added to §5.5.1.
- 2026-10-14 — P1-T01 — Schema v1 with Drizzle (identity, settings, jobs, caches, platform tables), take_token, updated_at triggers, RLS on every table with the single notifications policy; migrations apply to a fresh database and to local Supabase. Test isolation uses one scratch database per test file cloned from a migrated template (not a schema per file as §11.3 says) because migrations create enum types in public. CI now starts Supabase and applies migrations.
- 2026-10-14 — P0-T09 — Maintained docs scaffold: ALGORITHMS, DATA_SOURCES, PRIVACY, runbooks index + local-setup, ADR-001 (versions, licenses, pins for TypeScript 6 / ESLint 9 / turbo, sharp removal; Supabase Free and Vercel Hobby terms read 2026-10-14; unverified terms listed explicitly).
- 2026-10-14 — P0-T08 — CI workflow (verify + e2e on PRs, gitleaks scan), Dependabot, PR template, .gitleaks.toml; CI run 38461163142 green on push. Supabase start and db:migrate join the workflow with the first migration (P1-T01).
- 2026-10-14 — P0-T07 — check:hardcoded (TypeScript AST: numbers > 1 and 3+ string arrays in core and algorithms unless a documented constant or allowed-literal), check:licenses (SPDX expression evaluation over the production closure, reviewed exceptions file), check:contrast (WCAG AA over token pairs; skips until tokens exist), all tested with deliberate violations and wired into pnpm verify. sharp excluded (LGPL libvips); images served unoptimized.
- 2026-10-14 — P0-T06 — supabase/config.toml (GitHub provider via env(), mail catcher with SMTP port, Drizzle owns migrations), db:start/stop/status scripts, packages/env (client, server, worker schemas; lazy per-variable reads; assert*Env at startup), .env.example, one root .env.local for web, worker and scripts. Web startup without variables fails with the full list; with .env.local it runs.
- 2026-10-14 — P0-T05 — Testing infrastructure: jsdom + Testing Library preset, MSW server helper (unhandled requests fail), axe helpers for Vitest and Playwright, Playwright config (desktop + 360px) with a /health smoke test; pnpm test and pnpm test:e2e pass locally.
- 2026-10-14 — P0-T04 — Next.js 16 app shell in apps/web with Tailwind 4, base layout, security headers, /health page and /api/health route (version, commit, server time).
- 2026-10-14 — P0-T03 — Skeletons for the nine packages and apps/worker (README, src/index.ts, sample test each); first real code: stats mean/clamp and the worker's non-overlapping run loop. Turbo's auto-generated AGENTS.md removed and disabled (agentGuidance: false) because it is outside the §4.1 layout.
- 2026-10-14 — P0-T02 — pnpm workspace with catalog, Turborepo pipelines, packages/config (strict tsconfig, ESLint flat config with boundary + AI-SDK + fixture rules, Prettier, Vitest preset). TypeScript pinned to 6.0.x and ESLint to 9.x because typescript-eslint and the React/a11y plugins do not yet support TS 7 / ESLint 10; turbo pinned to 2.11.7 (newest release past pnpm's release-age cutoff).
- 2026-10-14 — P0-T01 — Repo initialised with .gitignore, .editorconfig, .gitattributes, .nvmrc (Node 24), MIT LICENSE, README stub; pushed to origin/main. HUMAN follow-up still open: protect `main` (require CI, block force pushes).
- 2026-10-13 — spec — CLAUDE.md v1 created: 22 features, 8 phases, 85 tasks.
