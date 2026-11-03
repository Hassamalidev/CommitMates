# ADR-010: Security review before launch

Date: 2026-11-04 · Status: accepted

## Context

P7-T01 walks the threat model of CLAUDE.md §5.10 before launch: content security policy, row level security on every table, input validation on every action and route, and the dependency tree. This record lists what was checked, what was found and what was done. It grows with each part of the review (P7-T01a dependencies, P7-T01b headers, RLS and token rotation, P7-T01c input validation and the threat model walk).

## Decision

### Dependencies (P7-T01a)

`pnpm audit --prod` on 2026-11-04 reported 18 advisories (2 critical, 6 high, 10 moderate) in five packages:

| Package | Where | Advisories | Action |
| --- | --- | --- | --- |
| `next` 16.4.0 | `apps/web` | 2 critical, 1 high, fixed in 16.4.1 | Upgraded to 16.4.3 (released 2026-10-23, MIT) |
| `re2js` 2.8.6 | `packages/sources` (Linguist and gitleaks patterns) | 1 high, fixed in 2.8.7 | Upgraded to 2.9.1 (MIT) |
| `nodemailer` 10.0.12 | `packages/email` | 5 moderate, fixed in 10.1.4 | Upgraded to 10.2.0 (MIT-0; the license exception of ADR-009 still applies) |
| `undici` 8.x | test environment only (`vitest` → `jsdom`) | 4 high, 4 moderate, fixed in 8.12.2 | `pnpm-workspace.yaml` override to `^8.12.3` until jsdom requires it |
| `minimatch` 10.2.6 | lint toolchain only (`typescript-eslint`, `eslint-plugin-import-x`) | 1 moderate (denial of service through pattern amplification), fixed in 11.0.1 | Not upgraded; see below |

The release-age rule of the workspace (versions old enough to have been reviewed) was kept: every chosen version was at least several days old.

**minimatch is accepted, not fixed.** The only fixed line, 11.x, is licensed BlueOak-1.0.0, which is outside the license allow-list of CLAUDE.md §2.2, and its dependents pin 10.x. The vulnerable code runs only in ESLint on this repository's own glob patterns, never on user input and never in shipped code. Dependabot will offer the fix once the toolchain moves; until then the risk is a slow lint run on a crafted pattern committed to this repository, which review would catch.

The Next.js build had already been printing an upgrade advisory for 16.4.0 (noted in the P6-T07a changelog line); it no longer does.

### Content security policy (P7-T01b)

**Finding:** no Content-Security-Policy was sent; `next.config.ts` still said it would arrive with auth.

**Fix:** the proxy (`apps/web/src/proxy.ts`) creates a 128-bit nonce per request and sends the policy built in `apps/web/src/lib/csp.ts` on the request (Next reads the nonce from it and puts it on its own scripts) and on the response:

- `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` only under the development server); the theme script in the root layout carries the nonce;
- `connect-src 'self'` and the Supabase origin with its `ws:`/`wss:` Realtime endpoint; `img-src 'self' https://avatars.githubusercontent.com data: blob:`; `font-src 'self'`;
- `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'`, `default-src 'self'`.

`style-src` keeps `'unsafe-inline'`: React, Radix and the companions set `style` attributes for sizes and positions, which nonces cannot cover, and styles cannot run script under this policy. The other headers of §5.10 (HSTS, `nosniff`, referrer policy, permissions policy, `X-Frame-Options`) were already sent from `next.config.ts`.

**Cost:** a nonce is per request, so the root layout reads it and every page now renders per request. The public pages that ADR-006 prerendered render on the server again; the sign-in state stays in the browser, so they still make no Supabase call while rendering. P7-T02 re-measures the landing page against §11.6.

**Tested:** `apps/web/src/lib/csp.test.ts` (directives, development additions, nonce shape) and `e2e/csp.spec.ts` (the header on public and members pages, a different nonce per request, client code hydrates, and the browser reports no violation).

### Row level security and database privileges (P7-T01b)

Audited with catalog queries and turned into tests in `packages/db/src/schema/schema.test.ts`:

- every table of the public schema has RLS enabled (already tested);
- every policy is a `SELECT` on `notifications`, `messages` or `thread_members` and depends on `auth.uid()`; views run as the invoker (`credit_balances`); the Realtime publication holds only those three tables;
- reading every table as `anon` and as an `authenticated` member returns nothing, apart from the member's own rows of the three browser tables (the previous test covered the Phase 1 tables only).

**Finding:** `set_updated_at`, `credit_ledger_append_only` and `immutable_array_to_string` were executable by `anon` and `authenticated`. Supabase exposes public functions as RPC endpoints. The trigger functions cannot be called outside a trigger and the text helper is harmless, but nothing in the browser needs them. **Fix:** migration `0070_revoke_function_execute.sql` revokes EXECUTE from `PUBLIC`, `anon` and `authenticated`, and changes the schema's default privileges so later functions are not executable by them either. A test asserts the browser roles can execute no function of the schema. (`take_token` was already revoked in P1-T01.)

### Token key rotation (P7-T01b)

**Finding:** the job catalog (§5.4) lists `reencrypt_tokens` for key rotation, but it did not exist, so rotating the key would have left every stored token readable only through `TOKEN_ENCRYPTION_KEY_PREV` forever.

**Fix:** `reencrypt_tokens` (`packages/core/src/security/tokens.ts`) rewrites every token not on the current key version, a page at a time and continuing across runs; it replaces a token only if it is unchanged since it was read; a token neither key can read is dropped and its member asked to sign in again; a missing previous key stops the run before anything changes. `pnpm tokens:reencrypt` queues it once per key version. The steps are in `docs/runbooks/rotate-token-key.md`. Tested in `packages/core/src/security/tokens.test.ts`.

## Alternatives considered

- **Overriding minimatch to 11.x.** Rejected: it brings a license outside §2.2 into the tree, and the advisory does not reach shipped code.
- **Staying on 16.4.0 until a minor release.** Rejected: the advisories are critical and in the web framework itself.
- **A hash-based CSP to keep the public pages prerendered.** Rejected: Next inlines a different flight-data script on every page, so the hashes would change with every build and page, and §5.10 asks for nonces.
- **Dropping `'unsafe-inline'` from `style-src`.** Rejected for now: the style attributes React and the UI components set would break, and inline styles cannot execute script under this policy.

## Consequences

- `pnpm audit --prod` reports one moderate advisory (minimatch, lint only) instead of 18.
- Upgrades go through the usual gates: `pnpm verify` and the e2e suite pass on the new versions.
- Every page now renders per request (the price of a nonce), and the public pages are no longer static; see ADR-006 and P7-T02.
- A key rotation is a documented, tested procedure.

## Verification

Advisories read from `pnpm audit --prod --json` (npm bulk advisory endpoint) on 2026-11-04. Versions and release dates from `npm view <package> time` on 2026-11-04; licenses from `npm view <package>@<version> license`: next 16.4.3 MIT, re2js 2.9.1 MIT, nodemailer 10.2.0 MIT-0, minimatch 11.0.3 BlueOak-1.0.0.
