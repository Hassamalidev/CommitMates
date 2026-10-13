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

### Mean and clamp

- Code: `packages/algorithms/src/stats/basic.ts`
- Formula: `mean = Σx / n` (0 for an empty list); `clamp(x, lo, hi) = min(hi, max(lo, x))` (NaN maps to `lo`)
- Settings: none
- Tests: `packages/algorithms/src/stats/basic.test.ts`
- Spec: CLAUDE.md §2.1

## Similarity

No entries yet. Cosine, Jaccard and histogram intersection arrive with the Dev Card and Compatibility Check (P2-T07, P2-T09).

## Information retrieval

No entries yet. YAKE and BM25 arrive in P2-T17; TF-IDF in P4-T02.

## Clustering, graphs and assignment

No entries yet. k-means with silhouette selection arrives in P6-T06; cycle search in P5-T06.

## Scoring

No entries yet. Each scoring rule is added by the task that implements its feature.
