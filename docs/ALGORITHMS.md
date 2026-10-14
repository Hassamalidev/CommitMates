# Algorithms

Every formula as implemented, with its settings keys and tests. The specification is CLAUDE.md §8; this file records what the code actually does. Update it in the same commit as the code it describes.

All algorithms live in `packages/algorithms` and are pure: no I/O, no clock, no unseeded randomness. Settings values are passed in as arguments (CLAUDE.md §10.7).

## How to add an entry

```markdown
### <Name>

- Code: `packages/algorithms/src/<folder>/<file>.ts`
- Formula: …
- Settings: `<key>` (default …)
- Tests: `packages/algorithms/src/<folder>/<file>.test.ts`
- Spec: CLAUDE.md §8 F<n>
```

## Statistics

### Mean, deviation and percentiles

- Code: `packages/algorithms/src/stats/basic.ts`
- Formula: `mean = Σx / n` (0 for an empty list); `clamp(x, lo, hi) = min(hi, max(lo, x))` (NaN maps to `lo`); population standard deviation `σ = sqrt(Σ(x − mean)² / n)`; coefficient of variation `σ / mean` (0 when the mean is 0); `percentile(values, p)` interpolates linearly at rank `p·(n − 1)` of the sorted values; `percentileRank(samples, x) = (count below + half the count equal) / n`
- Settings: none
- Tests: `packages/algorithms/src/stats/basic.test.ts`
- Spec: CLAUDE.md §2.1

## Time

### Local clock

- Code: `packages/algorithms/src/time/local.ts`
- Formula: the hour (0–23) and weekday of an instant as a wall clock in an IANA timezone shows them, daylight-saving shifts included, read through `Intl.DateTimeFormat` (the runtime's timezone database, no dependency). `weekdayOfDate` gives the weekday of a `YYYY-MM-DD` calendar date.
- Settings: none
- Tests: `packages/algorithms/src/time/local.test.ts` (offsets across midnight, both New York daylight-saving changes of 2026, unknown zones)
- Spec: CLAUDE.md §8 F1 steps 1–3, §10.9

## Persona (Dev Card)

### Rhythm metrics

- Code: `packages/algorithms/src/persona/metrics.ts`
- Formula:
  - event weight = commits of a push, capped at 20; 1 for any other event
  - `hourHist[h]` = weight at local hour `h` ÷ total weight (all zeros without events)
  - `nightShare` = sum over hours 22, 23, 0, 1, 2, 3; `morningShare` = sum over hours 5–8
  - `weekendShare` = contributions on Saturday and Sunday ÷ all contributions in the window
  - `activeDayShare` = days with a contribution ÷ days in the window
  - `cv` = coefficient of variation of the daily counts in the window
  - `longestStreak` = longest run of consecutive days with a contribution
- Settings: none; the windows (90 and 365 days) are chosen by the caller
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 2–4

### Labels, activity score and companion stage

- Code: `packages/algorithms/src/persona/labels.ts`
- Formula:
  - a label applies when its metric ≥ its threshold; strength = metric ÷ threshold; at most three labels, strongest first; nobody above a threshold is `balanced`. A threshold of zero or less disables its label.
  - activity score = percentile rank of the year's contributions among recorded samples; before enough samples exist, `min(1, log10(1 + x) / log10(1 + ref))`
  - stage = index of the first `companion.stageCuts` value above the activity score
- Settings: `persona.nightOwl.share` (0.35), `persona.earlyBird.share` (0.30), `persona.weekendWarrior.share` (0.40), `persona.sprinter.cv` (1.5), `persona.marathoner.activeDayShare` (0.5), `companion.activityRef` (1000), `companion.stageCuts` ([0.25, 0.5, 0.75, 0.9])
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 7–9

### Language shares and skill tags

- Code: `packages/algorithms/src/persona/skills.ts`
- Formula:
  - language share = bytes of the language across non-fork repositories ÷ all bytes; the top six are kept and the rest summed as `other`
  - tag weight = repositories whose dependencies carry the tag + repositories that list it as a topic, divided by the largest such weight; the top twelve are kept. Ties are broken by name.
- Settings: none
- Tests: `packages/algorithms/src/persona/persona.test.ts`
- Spec: CLAUDE.md §8 F1 steps 5–6

## Similarity

No entries yet. Cosine, Jaccard and histogram intersection arrive with the Dev Card and Compatibility Check (P2-T07, P2-T09).

## Information retrieval

No entries yet. YAKE and BM25 arrive in P2-T17; TF-IDF in P4-T02.

## Clustering, graphs and assignment

No entries yet. k-means with silhouette selection arrives in P6-T06; cycle search in P5-T06.

## Scoring

No entries yet. Each scoring rule is added by the task that implements its feature.
