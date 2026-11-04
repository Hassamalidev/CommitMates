# CommitMates

A university-verified network for student developers. It turns real GitHub activity into a living profile, finds you the right partner at your own university, and helps you finish things together: projects, code reviews, open-source contributions and final-year projects.

**Find a coding partner at your uni, and actually finish something together.**

## What it does

**Open to everyone** (no sign-in needed, live public GitHub data):

- **Dev Card:** languages, verified skills, coding rhythm and a generated pixel companion.
- **Compatibility Check:** how two developers would work together, with the reasons.
- **Recruiter-Ready Score:** a profile audit with evidence and fixes, plus a private secret scan for your own account.
- **Group Fairness Report:** who contributed what to a team repository, presented neutrally.
- **Gap Finder:** what similar projects have that yours lacks.
- **Project Graveyard:** inactive projects worth reviving, with polite adoption links.
- **Open-Source Starter:** beginner issues from projects whose maintainers actually reply.
- **FYP Idea Checker:** existing projects close to a final-year-project idea.

**For verified members of a university**, as more classmates join:

- matching and safe chat, shared streaks;
- adoptions of classmates' projects, a review exchange with verified reviews, skill swaps;
- seniors' projects, leaderboards, quick questions to alumni;
- a hackathon squad builder and a final-year-project board.

There is no AI anywhere: every score comes from classic algorithms over real data, with its evidence shown. There are no ads, and no data is sold or shared. Members can export or delete everything.

## Run it locally

Requirements: Node (version in `.nvmrc`), pnpm, and Docker for the local Supabase stack. The full guide is [docs/runbooks/local-setup.md](docs/runbooks/local-setup.md).

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm db:start                # local Supabase (Docker)
pnpm db:migrate
pnpm dev                     # web app + worker loop
```

Run every check before pushing:

```bash
pnpm verify      # lint, typecheck, quality checks, tests, build
pnpm test:e2e    # Playwright against the local stack
```

## Documentation

- [CLAUDE.md](CLAUDE.md): the complete specification. It covers the product, rules, architecture, data model, feature specs, design system, the roadmap (§16) and the changelog (§17).
- [docs/ALGORITHMS.md](docs/ALGORITHMS.md), [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md), [docs/PRIVACY.md](docs/PRIVACY.md): what was built, where the data comes from, and what is stored about whom.
- [docs/decisions/](docs/decisions/): architecture decision records.
- [docs/runbooks/](docs/runbooks/): setup, deployment, backups, key rotation and launch.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to propose a change.

## Stack

TypeScript end to end: Next.js on Vercel, and Postgres on Supabase (auth, realtime and pg_cron). A Postgres job queue does the background work. All code is under free, permissive licenses, and the full list is on the site's attribution page.

## License

[MIT](LICENSE)
