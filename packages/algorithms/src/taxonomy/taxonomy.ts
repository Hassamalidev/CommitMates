/**
 * Taxonomy expansion: which topics and dependencies belong to a search term.
 * Formula: sampleFreq(x) = share of sampled repositories containing x;
 *          score(x) = sampleFreq(x) × log(1 + maxGlobal / globalCount(x)), maxGlobal being the
 *          largest global count among this term's candidates of the same kind; without a
 *          global count the score is sampleFreq alone; keep sampleFreq ≥ minSampleFreq, top N
 * Settings: taxonomy.minSampleFreq, taxonomy.maxExpansions
 * Spec: CLAUDE.md §8 F6 "Algorithm"
 */

/** Terms shorter than this are rejected (§8 F6 "Edge cases"). */
export const MIN_TERM_LENGTH = 2;
/** Score of an alias of the term's own topic, and of a topic GitHub lists as related (§8 F6 step 2). */
export const ALIAS_SCORE = 1;
export const RELATED_SCORE = 0.5;

export type ExpansionItem = {
  kind: 'topic' | 'dependency';
  value: string;
  score: number;
  source: 'alias' | 'related' | 'cooccurrence';
};

/** The term as searched and as a topic slug; `null` when it is too short to mean anything. */
export function normalizeTerm(raw: string): { term: string; slug: string } | null {
  const term = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  if (term.length < MIN_TERM_LENGTH) return null;
  return { term, slug: term.replace(/ /g, '-') };
}

/** Share of samples (each a set of values) that contain each value. */
export function sampleFrequencies(samples: readonly (readonly string[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    for (const value of new Set(sample)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const frequencies = new Map<string, number>();
  if (samples.length === 0) return frequencies;
  for (const [value, count] of counts) frequencies.set(value, count / samples.length);
  return frequencies;
}

export type TaxonomyCandidate = {
  kind: ExpansionItem['kind'];
  value: string;
  sampleFreq: number;
  /** How common the value is overall; `null` when unknown, then only the sample counts. */
  globalCount: number | null;
};

/** Scores and keeps the candidates that are both frequent in the sample and specific to it. */
export function scoreCandidates(
  candidates: readonly TaxonomyCandidate[],
  options: { minSampleFreq: number; maxExpansions: number },
): ExpansionItem[] {
  const kept = candidates.filter((candidate) => candidate.sampleFreq >= options.minSampleFreq);
  const maxGlobal = new Map<string, number>();
  for (const candidate of kept) {
    if (candidate.globalCount !== null) maxGlobal.set(candidate.kind, Math.max(maxGlobal.get(candidate.kind) ?? 0, candidate.globalCount));
  }
  return kept
    .map((candidate) => {
      const max = maxGlobal.get(candidate.kind) ?? 0;
      const score =
        candidate.globalCount === null || max === 0
          ? candidate.sampleFreq
          : candidate.sampleFreq * Math.log(1 + max / Math.max(1, candidate.globalCount));
      return { kind: candidate.kind, value: candidate.value, score, source: 'cooccurrence' as const };
    })
    .sort((a, b) => b.score - a.score || (a.value < b.value ? -1 : 1))
    .slice(0, Math.max(0, options.maxExpansions));
}

/** Seeds first (aliases, then related topics), then learned items not already present. */
export function mergeExpansion(seeds: readonly ExpansionItem[], learned: readonly ExpansionItem[]): ExpansionItem[] {
  const seen = new Set<string>();
  const result: ExpansionItem[] = [];
  for (const item of [...seeds, ...learned]) {
    const key = `${item.kind}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
