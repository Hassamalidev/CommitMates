# ADR-005: Keyphrase extraction, BM25 and the stopword dataset

Date: 2026-10-14 · Status: accepted

## Context

P2-T17 needs YAKE keyphrase extraction and BM25 ranking for the FYP Idea Checker (CLAUDE.md §8 F9), a stopword list per language that is not written by hand (§2.3), and YAKE reference outputs "generated once from the reference implementation and committed" (§11.2).

## Decision

### Stopwords: stopwords-iso

The stopword lists come from [stopwords-iso](https://github.com/stopwords-iso/stopwords-iso) (MIT, © 2020 Gene Diaz): one JSON file with lists for 58 languages, synced weekly by `sync_stopwords` into the `stopwords` table (one row per ISO 639-1 code). Callers ask for a language and fall back to English.

| Candidate | License | Notes |
| --- | --- | --- |
| stopwords-iso | MIT | Many languages, one file, maintained |
| NLTK stopwords | Apache-2.0 corpus behind a downloader | Needs Python tooling to fetch |
| YAKE's own lists | Shipped inside an LGPL-3.0 package | License outside §2.2 for shipped data |

### YAKE: a TypeScript port of the scoring

`packages/algorithms/src/ir/yake.ts` follows the reference implementation's scoring (yake 0.4.8, `datarepresentation.py`) term by term: word tags, the five term features, the co-occurrence graph with a one-word window, the stopword bigram weighting inside candidates, `S = Π H / (TF · (1 + Σ H))`, and deduplication by normalized Levenshtein similarity (threshold 0.8, as §8 F9 states). Sentence and word splitting use simple rules instead of the reference's tokenizer library (segtok): sentences end at blank lines and at terminal punctuation followed by a capital, digit or quote; words keep inner hyphens and apostrophes, and contractions are split as the reference does.

### Reference outputs

The reference package is LGPL-3.0, outside the license allow-list for shipped code. It is never a dependency: it was installed once in a throwaway virtual environment, run on three sample texts with the stopwords-iso English list, and only its outputs were committed (`packages/algorithms/src/__fixtures__/yake/reference.json`, with the script that produced them). The port's test requires, per text, at least 8 of the reference's top 10 keyphrases, the same top 3 in order, and scores within 20 % for the shared ones; the remaining difference comes from tokenization.

### BM25

Okapi BM25 with `k1` and `b` from settings (`ir.bm25.k1`, `ir.bm25.b`) and the non-negative idf `ln(1 + (N − n + 0.5) / (n + 0.5))`.

## Alternatives considered

- **Port segtok as well**, for exact scores. Rejected: a large rule set for little gain at the ranking level, which the tests already pin.
- **A JavaScript YAKE package from npm.** None was maintained with a permissive license at the time of writing.

## Consequences

- Keyphrases are the reference's in practice; scores can differ slightly on texts with unusual punctuation.
- Before the first `sync_stopwords`, the stopword set is empty and YAKE treats only words shorter than three characters as stopwords.

## Verification

stopwords-iso license read from its repository on 2026-10-14 (MIT). yake 0.4.8 metadata read on 2026-10-14 (LGPLv3). `pnpm check:licenses` covers every shipped dependency; neither dataset adds one.
