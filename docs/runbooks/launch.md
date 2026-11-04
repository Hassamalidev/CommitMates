# Launch checklist

When to use: before tagging `v1.0.0` and announcing the site, and again before any later public release.

Prerequisites: the deployment from [deploy.md](deploy.md) for both staging and production.

Items are ticked when done, with the evidence next to them. `v1.0.0` is tagged only when every box is ticked.

## Steps

### 1. Code and checks (done in the repository)

- [x] `pnpm verify` and the full Playwright suite pass on `phase/7-launch`, locally and in CI (§11.5).
- [x] Security review: dependency audit, CSP with nonces, RLS and function grants, input validation of every action and route, threat model ([ADR-010](../decisions/ADR-010-security-review.md)).
- [x] Database hot paths checked with `EXPLAIN` on realistic volumes; every foreign key indexed ([ADR-011](../decisions/ADR-011-performance.md)).
- [x] Accessibility: every page passes axe in both themes at desktop and 360 px, and the keyboard walkthrough passes ([ADR-012](../decisions/ADR-012-accessibility.md)).
- [x] Privacy policy, terms and a generated attribution page ([ADR-013](../decisions/ADR-013-legal-and-attribution.md)).
- [x] Backup and restore drill performed ([backup-restore.md](backup-restore.md)).
- [x] No fake or placeholder content in shipped code. On 2026-11-04 a scan for lorem ipsum, TODO, FIXME, "coming soon", dummy names and example addresses found none outside tests and fixtures (§2.4). Re-run it before each release:

  ```bash
  grep -rniE "lorem|ipsum|\bTODO\b|FIXME|coming soon|dummy|john doe|jane doe|example\.(com|org)" apps/web/src packages/*/src --include=*.ts --include=*.tsx | grep -vE "\.test\.|__fixtures__|/testing/|test-values"
  ```

### 2. Environments (needs the accounts, see [HUMAN_TODO.md](../HUMAN_TODO.md))

- [ ] Staging and production deployed as described in [deploy.md](deploy.md); `pnpm db:tick status` shows succeeded runs for both.
- [ ] `main` protected: CI required, force pushes blocked.
- [ ] Uptime monitors on `/` and `/health` for production.
- [ ] First production backup taken and stored off-machine.

### 3. Verification on staging (P7-T07b)

- [ ] `E2E_BASE_URL=<staging URL> pnpm exec playwright test`: the smoke spec and the live-data spec pass (a real Dev Card from GitHub; every source synced).
- [ ] `/admin/health` on staging shows no alerts, GitHub budgets read, the queue moving, and email sends counted.
- [ ] A real university email receives its code, and verification completes. Use your own university address.
- [ ] A real sign-in with GitHub completes, and the bootstrap admin can open `/admin`.
- [ ] Lighthouse on the deployed landing page and one tool page: record performance, LCP and route JavaScript in [ADR-011](../decisions/ADR-011-performance.md) against the §11.6 budgets.
- [ ] A screen-reader pass over the main flows ([ADR-012](../decisions/ADR-012-accessibility.md)).

### 4. Production

- [ ] Migrations applied to production after a backup; the tick enabled; `pnpm db:tick status` healthy.
- [ ] `E2E_BASE_URL=<production URL> pnpm exec playwright test e2e/smoke.spec.ts` passes.
- [ ] The phase branch merged into `main` (§12.4) and tagged `phase-7-done`.
- [ ] `v1.0.0` tagged on `main` and pushed:

  ```bash
  git switch main && git pull --ff-only
  git tag -a v1.0.0 -m "CommitMates 1.0.0"
  git push origin v1.0.0
  ```

## Verify it worked

Every box above is ticked. `https://<production>/api/health` returns the tagged commit, and the uptime monitors are green.

## Roll back

Promote the previous Vercel deployment (see [deploy.md](deploy.md)). A tag is not withdrawn; fix forward with `v1.0.1`.
