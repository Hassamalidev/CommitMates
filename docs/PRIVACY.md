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

## Export and deletion (as implemented)

- **Export:** `/settings/privacy` links to `GET /api/me/export`, a JSON download of every class A and B row about the member, grouped by table: every table listed below as class A, or class B for members. A test reads this file and fails if the export misses one. Secrets are left out: the encrypted GitHub token and a verification code's hash.
- **Deletion:** the member types their GitHub login (or `delete my account` without one).
  1. A confirmation email goes out first, best effort and within the daily cap; afterwards there is no address to send it to.
  2. One transaction deletes what no foreign key cascades from: analyses cached about the member (by login), their GitHub user row and their repositories with manifests, dependencies and paths. It also writes an `audit_log` entry whose target is `hashUserId(id)`.
  3. The Supabase auth user is deleted, and every class A and B table cascades from it.
  4. The session ends.
- **Not yet applicable:** §5.12 step 3 (ending pairs, withdrawing listings, refunding escrows, cancelling questions) and replacing a member's chat messages arrive with those features in Phases 4–6.
- **Deviation from §5.12 step 1:** the GitHub OAuth grant is not revoked by the server. Revoking a grant needs the OAuth app's client secret, which only Supabase Auth holds. The page links to GitHub's authorized-applications settings instead, where the member can revoke it.

## Field inventory

Row Level Security is enabled on every table. Only `notifications` (own rows), `thread_members` (own rows) and `messages` (threads the member belongs to) have policies; every other table is unreadable by the browser roles and is accessed only by server code.

### `users` (class A)

| Column | Why it exists | Retention | Deletion |
| --- | --- | --- | --- |
| `id` | Same id as the Supabase auth user | Until account deletion | Cascades from `auth.users` |
| `status` | Active, suspended or hidden pending review (safety) | Until account deletion | Cascade |
| `last_seen_at` | Activity for trust and metrics | Until account deletion | Cascade |

### `github_identities` (class A)

| Column | Why it exists | Retention | Deletion |
| --- | --- | --- | --- |
| `github_id`, `login`, `name`, `avatar_url` | Link the member to their public GitHub account | Until account deletion | Cascade from `users` |
| `token_enc`, `token_key_version` | The member's OAuth token, AES-256-GCM encrypted, so their analyses use their own rate limit | Until account deletion or sign-out revocation | Cascade; grant revoked on deletion |
| `token_invalid`, `scopes`, `private_contrib_visible` | Token health and what it may read | Until account deletion | Cascade |

### `profiles` (class A)

| Column | Why it exists | Retention | Deletion |
| --- | --- | --- | --- |
| `university_id`, `department_id`, `role`, `grad_year` | University membership, the basis of every campus feature | Until account deletion | Cascade from `users` |
| `timezone` | Member-facing day boundaries (streaks, digests) | Until account deletion | Cascade |
| `visibility`, `ghost_mode` | The member's privacy choices | Until account deletion | Cascade |
| `learning_goals`, `bio` | Shown on the profile; goals drive matching | Until account deletion | Cascade |
| `share_today_status` | Whether streak partners see if the member coded today (on by default, changeable) | Until account deletion | Cascade |
| `onboarded_at`, `verified_at`, `verified_via` | Verification state | Until account deletion | Cascade |

### `roles` (class A)

Admin and university-moderator grants with who granted them. Deleted by cascade from `users`.

### `email_verifications` (class A)

A member's university email verification: the address, its domain, the university, a SHA-256 hash of the code (peppered; the code itself is never stored or logged), its expiry, wrong-guess and daily-send counters. The address is kept only while verification is pending; on success it is set to null, together with the code hash, and only the domain remains. Deleted by cascade from `users`.

### `university_requests` (class A)

A member's request to add a university domain: the domain, the proposed name and country, its review status, the reviewer and an optional note to the member. No email address is kept. Deleted by cascade from `users`; a reviewer who deletes their account leaves `reviewed_by` empty.

### `vouches` (class A)

Who vouched for whom, and at which university. Visible to nobody else: a member sees only their own vouch count. Deleted by cascade when either member deletes their account; a vouch already used for verification does not undo it.

### `invites` (class A)

One random code per member and university, and how many invitees verified there after following it. Nothing about the invitees is stored with it. Deleted by cascade when the member deletes their account.

The invite link's university slug and code are kept in a session cookie (`cm_invite`, HTTP-only) until the invitee finishes onboarding; the cookie is then removed. It holds no personal data.

### `message_requests`, `threads`, `thread_members`, `messages` (class A)

Chat (CLAUDE.md §8 F12): first messages waiting for consent, threads and who is in them, and messages. A member's own message requests, memberships and messages are in their export. When a member deletes their account, their messages in threads shared with others are deleted and replaced by one system note per thread ("A member left this conversation", §5.12 step 2); threads only they were in are deleted. A deleted message keeps no text: its body is emptied and the thread shows that it was deleted. An accepted request also records a `connections` row. Requests and memberships are deleted by cascade. Members read messages and memberships of their own threads through Supabase Realtime; Row Level Security limits each to the member's threads.

### `blocks`, `reports` (class A)

Who a member blocked, and their reports about others: reason, optional details, the message the report is about (only one in a thread the reporter belongs to), and the moderation outcome. The reported member is never told who reported them. When enough distinct verified reporters report an account it is hidden pending review; the audit log records that with no actor and the member is notified. A report outlives the reporter's account (`reporter` becomes null), because it is evidence for moderation. A report about a member is deleted with that member's account.

### `match_suggestions`, `connections`, `trust_scores`, `skill_vectors` (class B for members)

Daily suggestions with their score components and explanation keys, connections made through features, the nightly trust score with its components, and the member's skill vector: base weights from their public code (languages and tags), the TF-IDF weighting within their university, and interest topics from their own and starred repositories. Recomputed from activity; deleted by cascade.

### `persona_snapshots` (class B)

The persona part of a member's latest Dev Card: the events window, rhythm metrics, up to three labels and the companion's inputs (seed, species key, palette, stage, traits). One row per member, replaced when their skill vector is recomputed, so Discover can show other members' companions and labels without rebuilding expired cards. In the member's export; deleted by cascade.

### `pairs`, `pair_days`, `pair_companions` (class A)

Shared streaks between two members: daily contribution counts as GitHub reports them, outcomes, freezes and the pair companion. Deleted by cascade when either member deletes their account.

### `notifications`, `notification_prefs` (class A)

In-app notifications and the member's email preferences. Deleted by cascade from `users`.

### `feedback` (class A)

Feedback text with the page it was sent from. `user_id` is set to null when the account is deleted, so the text stays without a link to the person.

### `email_daily_counts` (class D)

One row per UTC day with the number of emails sent, for the daily cap. No recipient, subject or content is stored.

### Email delivery

Member emails go to the address in Supabase Auth, read at send time. The `send_email` job stores only the member id and the template data (digest lines or an account-notice kind), never the address. Verification codes are never stored in a job or anywhere else: only their hash is kept (§5.10). Email bodies and addresses are not logged.

### `tool_sessions` (class D)

One row per day-one tool run: the tool name and `ip_hash_day = sha256(ip + daily_salt)`. No raw IP address is stored, and the salt is deleted when it rotates, so the hash cannot be reversed or linked across days. `user_id` and `converted_user_id` are set to null on account deletion. When someone signs up for the first time, `converted_user_id` is set on anonymous runs from the previous 24 hours that carry the same daily hash (the tool-conversion metric); it is computed from the sign-in request's address and today's salt, and nothing else about the runs is linked.

### `metric_samples`, `salts` (class D)

Anonymous numbers that tune thresholds: a metric key, a value, a salted subject hash and the salt period. Keys so far: `oss.responseHours` (per project, hashed by repository id), `recruiter.readmeChars` (README length of a well-starred showcased repository, hashed by repository id), `companion.activityScore` (written by the Dev Card), `persona.nightShare`, `persona.morningShare`, `persona.weekendShare`, `persona.cv`, `persona.activeDayShare`, `contrib.total365` (written by the Dev Card). The hash is `sha256(github_id + current aggregate salt)` and exists only so one person counts once per metric and period; the salt is rotated every `privacy.aggregateSaltRotationDays` and old salts are deleted, so a hash cannot be linked back to an account. Kept indefinitely.

### `audit_log`

Administrative actions. `actor_user_id` has no foreign key so the log survives account deletion; the deletion itself is logged with a hashed id only.

### `gh_users`, `gh_repos`, `repo_manifests`, `repo_dependencies` (class C for non-members, class B for members)

Public GitHub profile fields (login, name, free-text location, company, website, bio, follower counts), public repository metadata, and the dependency names read from manifest files.

| Whose data | Retention | Deletion |
| --- | --- | --- |
| Someone who has not signed up | `expires_at = fetched + privacy.nonUserRawTtlHours` (24 hours by default) | `purge_non_user_raw`, hourly; manifests and dependencies cascade from the repository |
| A member | No expiry; refreshed when they use the tools | With the account |
| The country index (Phase 6) | Refreshed by the crawler | Opt-out form; removed when GitHub returns 404 |

Recent public events (including commit messages GitHub publishes in them) are read to compute results and are not stored in any table.

### `analysis_cache` (class C for non-members, class B for members)

Computed tool results, keyed by kind, subject and a hash of the parameters. Kinds so far: `fyp` (subject = a truncated SHA-256 of the normalized idea text, never the text itself; keyphrases, public repository names, descriptions, stars and similarity; kept for `cache.searchTtlHours`), `oss` and `oss_repo` (public issues and project responsiveness; subject = the login asked about, or the languages), `gap` and `repo_facets` (subject = `owner/repo`; public repository structure, dependency tags and properties), `graveyard` (subject = scope and query; public repository metadata and signals), `graveyard_signals` (subject = `owner/repo`; README text up to 20,000 characters, commit messages, issue comment counts, release presence; public data, kept no longer than `cache.searchTtlHours`), `fairness` (subject = `owner/repo`; contributor display names, GitHub logins and avatars, commit and line counts per week; people without an account are keyed by a truncated SHA-256 of their email, never the address; always kept no longer than `privacy.nonUserRawTtlHours`), `recruiter` (subject = lowercased login, parameters = the claimed skills and, for an owner's own check, the owner's user id so nobody else can read that entry; rule credits and evidence, never a secret or where one is), `compat` (subject = the two lowercased logins, sorted; scores, components, shared tags and starred repositories; kept for `cache.compatTtlHours` only when both people are members, otherwise no longer than `privacy.nonUserRawTtlHours`), `dev_card` (subject = lowercased GitHub login; the result holds the login, name, avatar URL, GitHub id, language shares, skill tags, hour histogram, 90 days of daily contribution counts and the derived labels — all from public data, plus private contribution counts only when the account owner enabled them on GitHub and analyzed their own account).

Retention: `cache.devCardTtlHours` for members; for people who have not signed up, never longer than `privacy.nonUserRawTtlHours`. Expired rows are deleted hourly by `purge_non_user_raw`. A job's `result_ref` only points at the row; the result is delivered to the browser that holds the unguessable job id.

### `recruiter_reports` (class B)

A member's own Recruiter-Ready check with the secret scan: score, rule results, files scanned, and each finding as rule id, repository, path and line. The secret itself is never stored or shown. Readable only by that member (the server checks the signed-in member owns the row); deleted with the account.

### `generic_message_counts` (class D)

Short normalized commit messages (at most a few words, like "fix" or "update readme") with how many analyses saw them. No person, repository or time is stored with a message. Kept indefinitely.

### `gap_reports`, `repo_paths`

Public repository structure and the comparison of a repository with its peers: ids, facets, gaps. No personal data. `repo_paths` rows are deleted with their `gh_repos` row (which expires like other non-member data).

### `fairness_reports` (class D)

One row per Fairness Report run: repository id, data source, and team-level numbers (people count, Gini, least-share ratio, flag). No names, accounts or emails. Kept for the usage metric.

### `api_cache` (class C)

Cached GitHub API responses keyed by token identity, method and URL. Responses expire after `privacy.nonUserRawTtlHours` and are deleted hourly. Only public reference data fetched by the source syncs (Linguist, github/explore) is kept without expiry, to make conditional requests possible.

### `geocode_cache`

Normalized free-text location strings (lowercased, emoji and URLs removed) with their coordinates, city, country code and timezone. The string is sent to the geocoder on its own, without a login or any other profile field. Rows are kept forever and hold no reference to a person; `gh_users.geocode_key` points at a row and is deleted with the `gh_users` row (class C retention for non-members).

### Tables without personal data

`languages`, `path_patterns`, `topics`, `package_meta`, `registry_pacing`, `secret_rules`, `secret_global_allowlist`, `topic_global_counts`, `taxonomy_expansions`, `stopwords`, `universities`, `university_domains`, `disposable_domains`, `departments` (department names typed by members; `created_by` is set to null when that member deletes their account) (public reference data from open sources and from GitHub search totals), `settings`, `settings_history` (an `actor_user_id` for admin overrides), `jobs` (payloads may name a GitHub login or repository; rows are operational and short-lived), `job_schedules`, `github_budgets`, `rate_limit_buckets` (keys contain hashes, never raw IPs), `geocoder_lock`, `source_snapshots`.

## Environment and logs

- Logs are JSON (pino). Tokens, emails, one-time codes, message bodies, cookies, authorization headers and IP addresses are redacted by the logger's configuration. A member is identified in logs only by `hashUserId` (a truncated SHA-256), and request errors are logged by route without the query string.
- Error tracking (Sentry) is off unless `SENTRY_DSN` is set. When on, an event carries only the error type, message, stack, route, method and digest; no user, cookie, header, body or query string is ever added to it.
- Admin pages show GitHub budgets by identity kind (`server` or `member`), never by member id.

- `.env.local` holds secrets and is never committed. `EnvError` messages name the variable and the problem and never echo a value (`packages/env`, tested).
- The local Supabase stack uses its fixed development keys; they protect nothing outside the developer's machine.
