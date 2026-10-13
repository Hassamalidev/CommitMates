# Local setup

When to use: setting up CommitMates on a new development machine.

Prerequisites: Node 24 (see `.nvmrc`), pnpm 12, Docker running, git.

## Steps

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Start the local Supabase stack. The first run downloads several Docker images and can take a few minutes.

   ```bash
   pnpm db:start
   ```

   It uses ports 54321 (API), 54322 (Postgres), 54323 (Studio), 54324 (mail catcher UI) and 54325 (mail catcher SMTP).

3. Create the environment file at the repository root.

   ```bash
   cp .env.example .env.local
   ```

   Fill in the empty values:

   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`: printed by `pnpm db:status`.
   - `TOKEN_ENCRYPTION_KEY` and `OTP_PEPPER`: `openssl rand -base64 32` (one each).
   - `JOB_TICK_SECRET`: `openssl rand -hex 32`.
   - `GITHUB_SERVER_TOKEN`: a fine-grained personal access token with public read-only access.
   - `BOOTSTRAP_ADMIN_GITHUB_ID`: the `id` field of `https://api.github.com/users/<your-login>`.
   - `CONTACT_EMAIL` and `GEOCODER_USER_AGENT`: your contact address, in the format shown in the file.

4. Start the app and the worker.

   ```bash
   pnpm dev
   ```

## Verify it worked

- <http://localhost:3000/health> shows "Running" and a version.
- `pnpm verify` passes.
- `pnpm test:e2e` passes (install the browser once with `pnpm exec playwright install chromium`).

If a variable is missing or malformed, the server refuses to start and prints every problem, for example `DATABASE_URL: missing (not set)`.

## Roll back

```bash
pnpm db:stop
```

Stops the local stack and keeps its data. `pnpm exec supabase stop --no-backup` also deletes the local database.
