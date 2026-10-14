# @commitmates/email

Renders transactional email (plain text and simple inline-styled HTML) and sends it over SMTP with Nodemailer.

## Public API

- `renderEmail(template, data, brand)`: pure; templates are `verificationCode`, `digest` and `accountNotice`.
- `sendEmail(template, data, to)`: renders with the site name and URL from the environment and sends from `EMAIL_FROM` through `SMTP_*`.
- `setMailTransport(transport)`: test helper.

The daily cap (`email.maxPerDay`) is enforced by `deliverEmail` in `packages/core`, which owns the database (ADR-009). Call that, not `sendEmail`, from application code.

## Import boundaries

- May import: `env`
- Must not import: everything else

Enforced by ESLint from `packages/config/eslint/boundaries.js` (CLAUDE.md §4.3).
