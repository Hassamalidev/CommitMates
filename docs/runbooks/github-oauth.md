# GitHub OAuth apps and the server token

When to use: setting up sign-in for a new environment (local, staging or production), or replacing a leaked secret.

Prerequisites: a GitHub account that will own the apps; for staging and production, the Supabase project already created.

CommitMates asks GitHub for two scopes only: `read:user` and `user:email` (CLAUDE.md §2.7). Never add `repo`, `write:*` or `admin:*`.

## Callback URLs

GitHub redirects to Supabase Auth, not to the web app. Each environment needs its own OAuth app because an OAuth app has exactly one callback URL.

| Environment | Homepage URL | Authorization callback URL |
| --- | --- | --- |
| Local | `http://localhost:3000` | `http://127.0.0.1:54321/auth/v1/callback` |
| Staging | The staging site URL | `https://<staging-project-ref>.supabase.co/auth/v1/callback` |
| Production | The production site URL | `https://<prod-project-ref>.supabase.co/auth/v1/callback` |

## Steps

### 1. Create the OAuth app

1. Open <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Application name: `CommitMates (local)`, `CommitMates (staging)` or `CommitMates`.
3. Fill in the homepage URL and callback URL from the table above.
4. Leave **Enable Device Flow** off. Click **Register application**.
5. Copy the **Client ID**. Click **Generate a new client secret** and copy it now; GitHub shows it once.

### 2. Give the credentials to Supabase

**Local.** Create `supabase/.env` (it is gitignored):

```bash
cp supabase/.env.example supabase/.env
```

Fill in `SUPABASE_AUTH_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_GITHUB_SECRET`, then restart the stack so it reads them:

```bash
pnpm db:stop && pnpm db:start
```

**Staging and production.** In the Supabase dashboard: **Authentication → Sign In / Providers → GitHub**. Enable it and paste the client ID and secret. Then under **Authentication → URL Configuration**, set **Site URL** to the site's URL and add `<site URL>/auth/callback` to **Redirect URLs**. Under **Sign In / Providers → Email**, turn **Allow new users to sign up** off: GitHub is the only way in.

### 3. Create the server token

The server token pays for anonymous day-one tools and data-source syncs. It must be able to read public data and nothing else.

1. Open <https://github.com/settings/personal-access-tokens> → **Generate new token** (fine-grained).
2. Token name: `commitmates-server-<environment>`. Expiration: 90 days or less; put a renewal reminder in your calendar.
3. **Repository access:** Public repositories (read-only).
4. **Permissions:** leave every permission at "No access". Public read access needs none.
5. Generate, copy the token, and set it as `GITHUB_SERVER_TOKEN` (`.env.local` locally; the hosting provider's environment variables for staging and production).

Use one token per environment. Never create extra tokens or accounts to raise rate limits (CLAUDE.md §2.5).

### 4. Set the bootstrap admin

Open `https://api.github.com/users/<your-login>` and copy the numeric `id`. Set it as `BOOTSTRAP_ADMIN_GITHUB_ID`. That account becomes an admin the first time it signs in.

## Verify it worked

1. Start the app (`pnpm dev`) and open the home page.
2. Click **Sign in with GitHub**. GitHub's consent screen should list only "Read all user profile data" and "Access user email addresses (read-only)".
3. After approving, you land back on the site, signed in.
4. In the database, `github_identities.token_enc` for your account starts with `v1.` (encrypted), and `roles` has an `admin` row for the bootstrap account.
5. `pnpm jobs:tick` runs without a `github.auth` error once a job that calls GitHub exists.

## Roll back

- A leaked client secret: generate a new one on the OAuth app page, update Supabase, then delete the old secret.
- A leaked server token: revoke it at <https://github.com/settings/personal-access-tokens>, create a new one, update `GITHUB_SERVER_TOKEN`, and redeploy.
- To remove sign-in entirely: disable the GitHub provider in Supabase. Existing sessions end when their tokens expire.
