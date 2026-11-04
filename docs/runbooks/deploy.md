# Deploy to staging and production

When to use: the first deployment of each environment, and every release after it (migrations first, then code). The environments are listed in CLAUDE.md §5.2.

Prerequisites:

- A Vercel account (Hobby) with access to the GitHub repository.
- Two Supabase projects, **staging** and **prod** (the free plan allows two).
- One GitHub OAuth app per environment and the server token: [github-oauth.md](github-oauth.md).
- SMTP settings from the email provider: [ADR-008](../decisions/ADR-008-email-provider.md).
- On the machine you deploy from: Node, `pnpm install` at the repository root, and Docker for `pnpm db:backup`.
- Treat every connection string, key and secret below as a secret: shell environment or Vercel only, never a file in the repository.

## Steps

### 1. Supabase, for each of staging and prod

1. Create the project in the region closest to your users, with a strong database password. Store it in your password manager.
2. **Project Settings → API**: copy the project URL, the publishable key and the secret key.
3. **Connect**: copy two connection strings.
   - The **transaction pooler** (port 6543) becomes `DATABASE_URL`, for the app (postgres.js with `prepare: false`).
   - The **direct connection** or session pooler (port 5432) becomes `DIRECT_DATABASE_URL`, for migrations, backups and the tick.
4. **Authentication → Sign In / Providers → GitHub**: enable it with that environment's OAuth client id and secret.
5. **Authentication → URL Configuration**:
   - Site URL: the environment's address, for example `https://commitmates.example` or the staging alias.
   - Redirect URLs: add `<site>/auth/callback`.

### 2. Vercel

1. **Add New → Project**, import the repository, and set **Root Directory** to `apps/web`. Keep "Include files outside the root directory" on: the app builds the workspace packages. The framework preset is Next.js. Vercel detects pnpm from the lockfile and the `packageManager` field.
2. Staging is a preview deployment with a stable address. Create a `staging` branch. Then, under **Settings → Domains**, add a domain or a `*.vercel.app` alias and assign it to the `staging` branch.
3. **Settings → Environment Variables**: set the variables below twice, once for **Production** (with the prod values) and once for **Preview** limited to the `staging` branch (with the staging values). Generate every secret separately per environment; the commands are in [.env.example](../../.env.example).

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SITE_URL` | The environment's address, without a trailing slash |
   | `NEXT_PUBLIC_SITE_NAME` | `CommitMates` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | From step 1.2 |
   | `SUPABASE_SECRET_KEY` | From step 1.2 |
   | `DATABASE_URL` | Transaction pooler, step 1.3 |
   | `DIRECT_DATABASE_URL` | Direct connection, step 1.3 |
   | `GITHUB_SERVER_TOKEN` | Fine-grained, public read-only ([github-oauth.md](github-oauth.md)) |
   | `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_VERSION` | `openssl rand -base64 32`, version `1` |
   | `OTP_PEPPER` | `openssl rand -base64 32` |
   | `JOB_TICK_SECRET` | `openssl rand -hex 32`; step 4 stores the same value in Vault |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | From the email provider |
   | `CONTACT_EMAIL` | A monitored address; it is shown on the legal pages and sent to data sources |
   | `GEOCODER_BASE_URL` | `https://nominatim.openstreetmap.org` |
   | `GEOCODER_USER_AGENT` | `CommitMates/1.0 (+<site URL>; <contact email>)` |
   | `BOOTSTRAP_ADMIN_GITHUB_ID` | Your numeric GitHub id |
   | `SENTRY_DSN` (optional), `LOG_LEVEL` (optional) | Leave unset unless needed |

4. Deploy. A missing or malformed variable stops the server at startup with the variable's name (never its value) in the function logs.

### 3. Migrations: staging, then prod

Run them from your machine before the code that needs them goes live (migrations are additive; CLAUDE.md §10.6):

```bash
DIRECT_DATABASE_URL='<staging direct connection>' pnpm db:migrate
# check staging (step 5), then:
BACKUP_DATABASE_URL='<prod direct connection>' pnpm db:backup   # before every prod migration
DIRECT_DATABASE_URL='<prod direct connection>' pnpm db:migrate
```

`pnpm db:migrate` prints `Migrations applied.` and does nothing when the database is current.

### 4. Enable the job tick

Background jobs run when pg_cron calls `POST <site>/api/jobs/tick` every minute (CLAUDE.md §5.4). For each environment:

```bash
DIRECT_DATABASE_URL='<direct connection>' JOB_TICK_SECRET='<same as Vercel>' NEXT_PUBLIC_SITE_URL='<site URL>' pnpm db:tick enable
```

The script:

1. enables `pg_cron` and `pg_net`;
2. stores the tick URL and the secret in Supabase Vault as `tick_url` and `tick_secret`, so neither appears in SQL or in logs;
3. schedules `jobs-tick` every minute with the command from §5.4.

Running it again replaces the schedule and the secrets, which is also how you rotate `JOB_TICK_SECRET`: change it in Vercel, redeploy, then run `enable` again.

### 5. Verify

1. Wait two minutes, then run `DIRECT_DATABASE_URL='<direct connection>' pnpm db:tick status`.
   - Expected: `jobs-tick: schedule "* * * * *", active`, recent runs `succeeded`, and responses `200`.
   - A `none (Timeout of 5000 ms reached …)` response is normal for a busy tick: pg_net stops waiting after 5 s (§5.4), but the site finishes the tick within `jobs.tickBudgetMs`. The first tick, which runs every schedule once, usually looks like this.
   - A `401` means the secret in Vault differs from Vercel's `JOB_TICK_SECRET`.
2. Sign in with GitHub on the site. The account whose id is `BOOTSTRAP_ADMIN_GITHUB_ID` becomes admin.
3. **/admin/jobs**: every schedule shows a recent *last run*, and nothing is dead. Migrations seed each schedule's next run at the time they ran, so the first tick runs them all once. That includes the source syncs (`sync_*`), which fill the universities, languages, topics and secret rules within the first minutes. Large syncs continue across ticks.
4. **/admin/health**: the queue is moving, the GitHub budgets have been read, and the email count is visible.
5. Production verification continues in P7-T07: e2e against staging, a real tool run, and a real email code.

## Verify it worked

- `pnpm db:tick status` shows succeeded runs and `200` responses.
- `/api/health` returns `{"status":"ok", …}` with the deployed commit.
- `/admin/health` shows no alerts after the first syncs finish.

## Roll back

- **Code:** Vercel → **Deployments** → the previous deployment → **Promote to Production** (instant).
- **Database:** migrations are additive, so the previous code runs on the newer schema. Restoring data is in [backup-restore.md](backup-restore.md).
- **Background work:** `pnpm db:tick disable` stops the tick and removes its Vault secrets. Nothing runs until `enable` again.

## Tested

On 2026-11-04, against the local Supabase stack (PostgreSQL 17.11, with `pg_cron` and `pg_net`), with the database calling the production build on the host (`TICK_URL=http://host.docker.internal:3100/api/jobs/tick`):

- `enable` scheduled `jobs-tick` and stored both Vault secrets.
- Over the next three minutes, the three cron runs succeeded. The first response timed out at 5 s, because that tick ran every schedule once; the next two answered `200`.
- The schedules were evaluated at the latest tick, and 209 jobs changed state.
- `disable` removed the job and both secrets, and `status` reported the tick off.

The steps that need the real Vercel and Supabase accounts are waiting in [HUMAN_TODO.md](../HUMAN_TODO.md).
