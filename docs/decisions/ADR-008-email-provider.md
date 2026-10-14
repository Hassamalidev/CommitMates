# ADR-008: Transactional email provider

Date: 2026-10-14 · Status: proposed (the account is created by a human, P3-T02)

## Context

Verification codes, digests and account notices go out over SMTP through Nodemailer (CLAUDE.md §3.1, §14.1), so the provider can be swapped with environment variables alone. §2.2 requires a free tier that fits the design, verified terms, and a settings key that keeps us under the quota (§3.2).

## Decision

Recommended: **Resend**, over SMTP.

- Free plan, read from <https://resend.com/pricing> on 2026-10-14: 3,000 emails per month, **100 emails per day**, SMTP relay included, up to 3 custom domains, no credit card required.
- `email.maxPerDay` stays at its seeded default of **80**: below the daily limit, with headroom for retries, and 80 × 31 = 2,480, under the monthly limit. The cap is enforced by the email package (P3-T03); sends beyond it are deferred to the next day.
- Sending requires a domain the human controls, verified with the DNS records Resend shows (SPF and DKIM). `EMAIL_FROM` uses that domain.

## Alternatives considered

- **Brevo:** its free plan is widely reported as 300 emails per day, with SMTP relay. I could not confirm the current terms on Brevo's own pricing page (it did not render its plan details), so it is not recommended until someone reads them. If chosen, record the terms here and set `email.maxPerDay` below the confirmed daily limit.
- **SMTP2GO:** its free plan is 1,000 emails per month (<https://www.smtp2go.com/pricing/>, read 2026-10-14). That is too tight for daily digests once members exist; if chosen, `email.maxPerDay` must be at most 30.
- **Provider SDKs** (instead of SMTP): rejected by §3.1, to avoid lock-in.

## Consequences

- Without a verified domain no email can be sent from staging or prod. Locally, the Supabase CLI mail catcher receives every message, so development and e2e tests do not depend on this ADR.
- The human may pick another provider; only the SMTP variables, `EMAIL_FROM`, this ADR and possibly `email.maxPerDay` change.

## Verification

Resend's terms read on its pricing page on 2026-10-14. SMTP2GO's monthly limit read on its pricing page the same day. Brevo's limits come only from third-party reviews and are unconfirmed.
