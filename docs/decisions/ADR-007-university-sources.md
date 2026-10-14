# ADR-007: University list and disposable email blocklist

Date: 2026-10-14 · Status: accepted

## Context

University verification (CLAUDE.md §8 F10) needs a live list of universities and their email domains (§6.4), and a blocklist of throwaway email domains (§6.5). P3-T01 chooses the blocklist and records both licenses.

## Decision

- **Universities:** [Hipo/university-domains-list](https://github.com/Hipo/university-domains-list), file `world_universities_and_domains.json` on `master` (about 2.2 MB). License MIT (GitHub license API, checked 2026-10-14). Last push 2026-09-22.
- **Disposable domains:** [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains), file `disposable_email_blocklist.conf` on `main` (about 143 KB, one domain per line). License CC0 1.0 Universal: the repository's `LICENSE.txt` is the CC0 deed. GitHub's license API reports `NOASSERTION` only because it cannot detect that file. Last push 2026-10-13, so the list is actively maintained. CC0 is a public-domain dedication, allowed by §2.2.
- Both are fetched with the server token through the GitHub contents API (raw media type, conditional requests), in the same way as the other GitHub-hosted sources. No extra host is contacted.

### Deviations from §7.2, recorded as spec fixes

- `university_domains` is keyed by `(domain, university_id)`, not by `domain` alone. §8 F10 expects universities that share a domain ("ask the user to choose among matches"), which a single-column primary key cannot store.
- `universities.source_key` (country code plus lowercased name) identifies a Hipo entry between syncs. The list has no ids, and the diff upsert in §6.4 needs a stable key. Entries repeated in the list are merged under that key.

## Alternatives considered

- **Blocklist alternatives** (other community lists, or paid validation APIs): the chosen list is the most widely used and actively maintained, and it is public domain. Paid APIs are excluded by §2.2.
- **The raw.githubusercontent.com URL** instead of the contents API: a second host with no rate-limit headers and no ETag-cache integration.

## Consequences

- A university dropped from the list is deleted only when it has no members; otherwise it stays with `source_missing = true` (§6.4).
- Slugs are assigned once and kept, so links do not change when a name is edited upstream.

## Verification

Licenses read on 2026-10-14 from the GitHub license API (Hipo: MIT) and from `LICENSE.txt` (blocklist: CC0 1.0). Fixture-based sync tests in `packages/sources/src/hipo/hipo.test.ts`.
