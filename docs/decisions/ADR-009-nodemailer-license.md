# ADR-009: Nodemailer (MIT-0) and the email send cap

Date: 2026-10-14 · Status: accepted

## Context

CLAUDE.md §3.1 names Nodemailer as the SMTP transport. Its license is **MIT-0** (MIT No Attribution), which is not on the §2.2 allow-list. §3.2 also requires that free-tier quotas are never exceeded.

## Decision

- **Nodemailer 10.0.12 as a reviewed license exception** (`scripts/license-exceptions.json`). MIT-0 is the MIT license with the notice requirement removed: it grants everything MIT grants, with fewer conditions. The allow-list itself is unchanged; extending it is the human's call (§0.9). The version is two weeks old: 10.1.1 was published on the day of this task and is held back by the workspace's `minimumReleaseAge` policy, which stays in force. pnpm had added an automatic exclusion for 10.1.1; it was removed.
- **Cap enforced in core, not in the email package.** `packages/email` may import only `env` (§4.3). It renders templates and delivers them. `deliverEmail` in `packages/core/src/notifications` first reserves a slot in `email_daily_counts` with an atomic conditional upsert (the counter moves only while below `email.maxPerDay`), then sends.
- **Beyond the cap a send is deferred, not dropped.** `EmailQuotaError` is a `RateLimitError` that resets at the next UTC midnight, so the job runner re-queues the job for then without consuming an attempt.
- **No secrets or addresses in job payloads.** `send_email` carries a member id and a template that holds no secret; the address is read from Supabase Auth at send time. Verification codes are sent by `send_otp` (P3-T04), which calls `deliverEmail` directly and stores only the code's hash.

## Alternatives considered

- **A provider SDK:** rejected by §3.1, because it ties the app to one provider.
- **Counting sends in the email package with its own store:** that would break the package boundary.
- **Counting after a successful send:** races could exceed the cap. Reserving first is conservative: a failed send still uses its slot, as it usually does at the provider.

## Consequences

`/admin/health` shows emails sent today against the cap and raises an alert above `admin.budgetAlertPct`.

## Verification

License read from the npm registry on 2026-10-14 (`nodemailer@10.0.12`: MIT-0; `@types/nodemailer@8.0.2`: MIT). Tests in `packages/core/src/notifications/email.test.ts` cover deferral, concurrent sends and the job wait.
