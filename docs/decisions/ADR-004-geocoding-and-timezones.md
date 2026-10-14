# ADR-004: Geocoding and offline timezone lookup

Date: 2026-10-14 · Status: accepted

## Context

P2-T05 turns the free-text location of a public GitHub profile into coordinates, a city, a country code and an IANA timezone (CLAUDE.md §6.8, §6.9, §8 F18 "Geocoding"). The spec fixes the geocoder (Nominatim, behind `GEOCODER_BASE_URL`) and leaves the coordinate-to-timezone library open: offline, permissive license, verified here.

## Decision

### Timezone library: `@photostructure/tz-lookup` 11.x

| Candidate | License | Installed size | State |
| --- | --- | --- | --- |
| `@photostructure/tz-lookup` | CC0-1.0 | about 90 KB | Maintained; tracks the timezone database |
| `tz-lookup` | CC0-1.0 | about 70 KB | Unmaintained for years; outdated zones |
| `geo-tz` | MIT | about 74 MB of boundary data | Exact boundaries, far too large for a serverless bundle |

`@photostructure/tz-lookup` is chosen. It trades exactness near borders for size, which fits the use: a default timezone for the rhythm chart of someone who has not signed up. Members always use the timezone from their own browser (§6.10).

CC0-1.0 is not in the code list of §2.2 (it is in the asset list). It is a public-domain dedication with no conditions, strictly more permissive than every license on the code list, and the package is essentially a data table with a small reader. `scripts/lib/licenses.ts` already accepts CC0-1.0, so no exception entry is needed. The table is derived from timezone-boundary-builder, whose boundaries come from OpenStreetMap (ODbL 1.0); the attribution page credits both.

### One geocoder call per interval, enforced by a row lock

Every call happens inside a transaction that holds the single `geocoder_lock` row `for update`. The transaction waits until `last_call_at + geocoder.minIntervalMs`, makes the request, stores the result and writes `last_call_at`. Two overlapping ticks therefore run strictly one after the other, each seeing the timestamp the other committed. A failed request still writes the timestamp and ends the run, so an unhealthy geocoder is asked at most once per minute.

Holding a transaction open across an HTTP request is normally avoided. Here it is the mechanism: the lock must cover the request, the wait is bounded by `geocoder.minIntervalMs` plus `sources.requestTimeoutMs`, and only one connection is ever inside it.

### Lookups are queued, never inline

`ingestProfile` calls `queueLocation`, which stores the normalized string as `pending` (or `unresolvable` for a non-place) and returns immediately. The first Dev Card for a new location therefore falls back to UTC and says so; a later run picks up the resolved timezone. This keeps interactive jobs independent of the geocoder and makes autocomplete-style use impossible.

## Alternatives considered

- **A Postgres advisory lock instead of a table row.** Rejected: the spec names the row, and the row also carries `last_call_at`.
- **A paid or keyed geocoder.** Forbidden by §2.2.
- **Resolving the location inline during the profile job.** Rejected: one slow lookup would hold a waiting user behind the app-wide queue.

## Consequences

- Timezones near borders and at sea can be off by one zone. The Dev Card labels the timezone source so the reader can tell.
- The geocoding queue drains at about one location per `geocoder.minIntervalMs`; the country crawler (P6) must not expect faster.
- Upgrading `@photostructure/tz-lookup` refreshes the timezone table; existing `geocode_cache` rows keep the zone computed at lookup time.

## Verification

License of `@photostructure/tz-lookup` read from its npm registry metadata on 2026-10-14 and enforced by `pnpm check:licenses`. The interval guarantee is tested in `packages/sources/src/geocoder/geocoder.test.ts` with two connection pools resolving the same queue against a simulated clock. The Nominatim usage policy was applied as CLAUDE.md §2.5 and §6.8 state it; the policy page itself was not re-read for this ADR and should be checked before the first production deploy (P7-T06).
