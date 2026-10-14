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
- Waiting on it: phases are merged with a local merge commit instead of a pull request. CI (including e2e) runs on every push to a phase branch, and a phase is merged only after that run is green.

### P1-T06 — GitHub OAuth app and server token (local)

- Why: sign-in with GitHub and every call to the GitHub API need them.
- Do this: follow [runbooks/github-oauth.md](runbooks/github-oauth.md) for the local environment.
- Then set: `SUPABASE_AUTH_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_GITHUB_SECRET` in `supabase/.env`; `GITHUB_SERVER_TOKEN` and `BOOTSTRAP_ADMIN_GITHUB_ID` in `.env.local`.
- Waiting on it: real sign-in in the browser, and any day-one tool run against live GitHub data. Automated tests do not need it: they use recorded fixtures and a locally created session.

### P3-T02 — Transactional email provider

- Why: verification codes (F10), digests and account notices need a real SMTP provider in staging and prod. Locally the Supabase mail catcher is enough.
- Do this (recommended provider in [ADR-008](decisions/ADR-008-email-provider.md)):
  1. Create a free account at <https://resend.com>.
  2. **Domains → Add domain**: add a domain you control (a subdomain such as `mail.yourdomain.com` works), then add the DNS records it shows at your DNS host and wait until it reports *Verified*.
  3. **API Keys → Create API key**, permission *Sending access*.
  4. SMTP settings: host `smtp.resend.com`, port `465`, user `resend`, password = the API key.
- Then set (staging and prod environment variables, not committed): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` such as `CommitMates <no-reply@mail.yourdomain.com>`.
- If you pick another provider, tell me its free daily limit; `email.maxPerDay` (80) must stay below it.
- Waiting on it: real emails from staging and prod (P7-T06, P7-T07). Development and tests are not blocked.
