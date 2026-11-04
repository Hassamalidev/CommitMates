# Contributing to CommitMates

Thanks for helping. CommitMates is a free, non-commercial project for student developers, and contributions of every size are welcome: bug reports, copy fixes, accessibility improvements, tests and features.

## Before you start

- [CLAUDE.md](CLAUDE.md) is the full specification: product rules (§2), architecture (§5), data model (§7), feature specs (§8), design system (§9) and conventions (§10). A change that conflicts with it needs a discussion first.
- Some rules are not negotiable (§2):
  - **No AI or language models.** That covers dependencies, hosted APIs and generated text.
  - **Only free and permissive licenses** (§2.2). `pnpm check:licenses` enforces this.
  - **No hard-coded domain data or tuning numbers.** Lists come from live sources, and numbers are settings (§2.3, §5.5).
  - **No fake data outside tests** (§2.4).
  - **Privacy first** (§2.6). People who never signed up get no page and no ranking.
  - **Kind, neutral language** about people (§2.8).
- For anything larger than a small fix, open an issue describing the problem and your approach before writing code.

## Set up

Follow [docs/runbooks/local-setup.md](docs/runbooks/local-setup.md). In short:

```bash
pnpm install
cp .env.example .env.local      # fill in the values
pnpm db:start                   # local Supabase in Docker
pnpm db:migrate
pnpm dev
```

## Make a change

- Put code where §4.4 says. Formulas go in `packages/algorithms` (pure, tested); external calls in `packages/github` or `packages/sources`; business logic in `packages/core`; UI in `packages/ui` and `apps/web`; user-facing words in `apps/web/src/copy/`.
- Validate every input with zod, and throw `AppError` subclasses with a friendly message (§10.4, §10.5).
- A new number that changes behavior becomes a settings key: in the seed migration and in §5.5.1.
- A schema change is a Drizzle migration (`pnpm db:generate`), additive only. Destructive changes need two steps and an ADR (§10.6).
- Add tests at the right layer (§11), with no network access in tests: use the recorded fixtures and MSW.
- Update the maintained docs your change touches: `docs/ALGORITHMS.md`, `docs/DATA_SOURCES.md`, `docs/PRIVACY.md`, or a new ADR in `docs/decisions/`.
- A new or removed production dependency needs `pnpm licenses:report`, and the result committed.

## Check and send

```bash
pnpm verify        # lint, typecheck, hardcoded-literal, license and contrast checks, tests, build
pnpm test:e2e      # Playwright, against the local Supabase stack
```

Both must pass. Never skip a test, lower a coverage threshold or disable a lint rule to get green.

Commits follow Conventional Commits (§12.2), for example `fix(graveyard): keep archived repositories fork-only`. Open a pull request against `main` and fill in the template.

## Report a problem

- **Bugs and ideas:** open an issue with the steps to reproduce, or use the feedback form on the site.
- **Security issues:** do not open a public issue. Email the address on the site's privacy page with the details, and give us time to fix the issue before disclosing it.
- **Your data:** export or delete it yourself on the privacy settings page. To keep your GitHub account out of the country index, use the opt-out page.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
