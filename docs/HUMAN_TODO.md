# Steps that need a human

Tasks in CLAUDE.md §16 marked **[HUMAN]** need accounts, secrets or approvals that only you can provide. The build continued past them; each is listed here with what is waiting on it. Remove an entry when it is done.

## Open

### P0-T01 — Protect `main`

- Why: so nothing reaches `main` without a green CI run.
- Do this: GitHub → the repository → **Settings → Branches → Add branch ruleset** for `main`: require status checks to pass (select the `verify` check), block force pushes.
- Waiting on it: nothing is blocked. Until it is done, phases are merged into `main` directly.

### P0 (optional) — Install the GitHub CLI

- Why: CLAUDE.md §12.4 ends each phase with a pull request (`gh pr create`, `gh pr merge`).
- Do this: install from <https://cli.github.com> and run `gh auth login`.
- Waiting on it: phases 0 and later were merged with a local merge commit instead of a pull request. The e2e CI job only runs on pull requests, so it has not run on GitHub yet; e2e tests run locally.

### P1-T06 — GitHub OAuth app and server token (local)

- Why: sign-in with GitHub and every call to the GitHub API need them.
- Do this: follow [runbooks/github-oauth.md](runbooks/github-oauth.md) for the local environment.
- Then set: `SUPABASE_AUTH_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_GITHUB_SECRET` in `supabase/.env`; `GITHUB_SERVER_TOKEN` and `BOOTSTRAP_ADMIN_GITHUB_ID` in `.env.local`.
- Waiting on it: real sign-in in the browser, and any day-one tool run against live GitHub data. Automated tests do not need it: they use recorded fixtures and a locally created session.
