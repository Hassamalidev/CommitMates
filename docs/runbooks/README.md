# Runbooks

Step-by-step guides for humans. Each runbook follows the template in CLAUDE.md §15.3: when to use it, prerequisites, steps, how to verify, how to roll back.

| Runbook | Purpose | Added in |
| --- | --- | --- |
| [local-setup.md](local-setup.md) | Run the app and the local Supabase stack on a new machine | P0-T09 |
| `github-oauth.md` | Create the GitHub OAuth apps and the server token for dev, staging and prod | P1-T06 |
| `rotate-token-key.md` | Rotate `TOKEN_ENCRYPTION_KEY` and re-encrypt stored tokens | P7-T01 |
| `backup-restore.md` | Back up the database and run a restore drill | P7-T05 |
| `deploy.md` | Apply migrations to staging then prod; enable the pg_cron tick | P7-T06 |
| `launch.md` | Launch checklist | P7-T08 |

Rows without a link are written by the task named in the last column.
