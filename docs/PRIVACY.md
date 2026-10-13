# Privacy

Every personal-data field the app stores: why it exists, how long it is kept, and how it is deleted. The specification is CLAUDE.md §2.6 and §5.12; this file records what is actually implemented. Update it in the same commit as the schema or code it describes.

## Principles

- People who never signed up get no public page and no ranking. Their raw cached data is deleted after `privacy.nonUserRawTtlHours`; only anonymous aggregates remain.
- Sensitive findings such as leaked secrets are shown only to the authenticated owner. The secret value is never stored.
- Every member can export all their data as JSON and hard-delete their account.
- IP addresses are never stored raw. Rate-limit keys use `sha256(ip + daily_salt)`.
- Logs never contain tokens, emails, one-time codes, message bodies or IP addresses.

## Data classes

| Class | What it is | Retention | Deletion path |
| --- | --- | --- | --- |
| A: member personal | Emails, profile, messages, ledger, listings | Until account deletion | Hard delete with cascades |
| B: member derived | Skill vectors, persona snapshots, reports | Recomputed; deleted with the account | Cascade |
| C: non-member public cache | Cached GitHub data and analyses about non-members | `privacy.nonUserRawTtlHours` | `purge_non_user_raw` job |
| D: anonymous aggregates | `metric_samples` | Kept | Not linkable to a person |
| E: country index | Minimal public metadata for search | Refreshed; removed when GitHub returns 404 | Opt-out form by GitHub login |

## Field inventory

No personal data is stored yet: the database schema arrives in P1-T01. Each table is added here by the task that creates it, in this form:

```markdown
### `<table>` (class <A–E>)

| Column | Why it exists | Retention | Deletion |
| --- | --- | --- | --- |
```

## Environment and logs

- `.env.local` holds secrets and is never committed. `EnvError` messages name the variable and the problem and never echo a value (`packages/env`, tested).
- The local Supabase stack uses its fixed development keys; they protect nothing outside the developer's machine.
