/**
 * Okapi BM25 relevance of documents to a query.
 * Formula: score(q, d) = Σ_t idf(t) · tf(t, d)·(k1 + 1) / (tf(t, d) + k1·(1 − b + b·|d| / avgdl)),
 *          idf(t) = ln(1 + (N − n(t) + 0.5) / (n(t) + 0.5)), summed over the query's terms (with repeats)
 * Settings: ir.bm25.k1, ir.bm25.b
 * Spec: CLAUDE.md §8 F9 steps 3–4
 */

const WORD = /[\p{L}\p{N}]+/gu;

/** Lowercased words without stopwords: the bag BM25 compares. */
export function bm25Tokens(text: string, stopwords: ReadonlySet<string>): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((word) => !stopwords.has(word));
}

export type Bm25Index = {
  documents: Map<string, number>[];
  lengths: number[];
  averageLength: number;
  documentFrequency: Map<string, number>;
};

/** Term counts, lengths and document frequencies of a corpus of already-tokenized documents. */
export function bm25Index(documents: readonly (readonly string[])[]): Bm25Index {
  const counted = documents.map((tokens) => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return counts;
  });
  const documentFrequency = new Map<string, number>();
  for (const counts of counted) for (const token of counts.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  const lengths = documents.map((tokens) => tokens.length);
  const averageLength = lengths.length === 0 ? 0 : lengths.reduce((total, length) => total + length, 0) / lengths.length;
  return { documents: counted, lengths, averageLength, documentFrequency };
}

/** BM25 score of every document in the index for the query's tokens. */
export function bm25Scores(index: Bm25Index, query: readonly string[], parameters: { k1: number; b: number }): number[] {
  const total = index.documents.length;
  return index.documents.map((counts, position) => {
    const length = index.lengths[position] ?? 0;
    const norm = index.averageLength === 0 ? 1 : 1 - parameters.b + parameters.b * (length / index.averageLength);
    let score = 0;
    for (const token of query) {
      const tf = counts.get(token) ?? 0;
      if (tf === 0) continue;
      const n = index.documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
      score += (idf * tf * (parameters.k1 + 1)) / (tf + parameters.k1 * norm);
    }
    return score;
  });
}
