/**
 * Gap Finder: what similar repositories usually have that this one does not.
 * Formula: p(f) = share of peers with facet f; expected facets have p(f) ≥ minPrevalence;
 *          gaps = expected facets the repository lacks, by p(f) descending, top maxGaps;
 *          shared = expected facets the repository already has
 * Settings: gap.minPrevalence, gap.maxGaps
 * Spec: CLAUDE.md §8 F5 steps 4–5
 */

export type FacetPrevalence = { facet: string; prevalence: number; peersWith: number };

/** Share of peers carrying each facet; every facet a peer lists counts once for that peer. */
export function facetPrevalence(peerFacets: readonly (readonly string[])[]): Map<string, FacetPrevalence> {
  const counts = new Map<string, number>();
  for (const facets of peerFacets) for (const facet of new Set(facets)) counts.set(facet, (counts.get(facet) ?? 0) + 1);
  const result = new Map<string, FacetPrevalence>();
  if (peerFacets.length === 0) return result;
  for (const [facet, peersWith] of counts) result.set(facet, { facet, prevalence: peersWith / peerFacets.length, peersWith });
  return result;
}

const byPrevalence = (a: FacetPrevalence, b: FacetPrevalence) => b.prevalence - a.prevalence || (a.facet < b.facet ? -1 : 1);

/** Facets most similar repositories have and this one lacks, most common first. */
export function findGaps(
  own: ReadonlySet<string>,
  prevalence: ReadonlyMap<string, FacetPrevalence>,
  options: { minPrevalence: number; maxGaps: number },
): FacetPrevalence[] {
  return [...prevalence.values()]
    .filter((entry) => entry.prevalence >= options.minPrevalence && !own.has(entry.facet))
    .sort(byPrevalence)
    .slice(0, Math.max(0, options.maxGaps));
}

/** Expected facets the repository already shares with its peers: what it is doing right. */
export function sharedFacets(own: ReadonlySet<string>, prevalence: ReadonlyMap<string, FacetPrevalence>, minPrevalence: number): FacetPrevalence[] {
  return [...prevalence.values()].filter((entry) => entry.prevalence >= minPrevalence && own.has(entry.facet)).sort(byPrevalence);
}
