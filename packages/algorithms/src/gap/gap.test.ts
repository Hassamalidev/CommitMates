import { describe, expect, it } from 'vitest';

import { facetPrevalence, findGaps, sharedFacets } from './gap';

const peers = [
  ['dir:tests', 'file:dockerfile', 'meta:license', 'dir:.github/workflows'],
  ['dir:tests', 'meta:license', 'dir:.github/workflows', 'dir:tests'],
  ['dir:tests', 'file:dockerfile', 'meta:license'],
  ['meta:license', 'file:makefile'],
];

describe('facetPrevalence', () => {
  it('counts each facet once per peer', () => {
    const prevalence = facetPrevalence(peers);
    expect(prevalence.get('dir:tests')).toEqual({ facet: 'dir:tests', prevalence: 0.75, peersWith: 3 });
    expect(prevalence.get('meta:license')?.prevalence).toBe(1);
    expect(prevalence.get('file:makefile')?.prevalence).toBe(0.25);
    expect(facetPrevalence([]).size).toBe(0);
  });
});

describe('findGaps and sharedFacets', () => {
  const prevalence = facetPrevalence(peers);
  const own = new Set(['meta:license', 'file:readme.md']);

  it('lists expected facets the repository lacks, most common first', () => {
    expect(findGaps(own, prevalence, { minPrevalence: 0.5, maxGaps: 8 }).map((gap) => gap.facet)).toEqual([
      'dir:tests',
      'dir:.github/workflows',
      'file:dockerfile',
    ]);
    expect(findGaps(own, prevalence, { minPrevalence: 0.5, maxGaps: 1 })).toHaveLength(1);
    expect(findGaps(own, prevalence, { minPrevalence: 0.9, maxGaps: 8 })).toEqual([]);
  });

  it('lists the expected facets it already has', () => {
    expect(sharedFacets(own, prevalence, 0.5).map((entry) => entry.facet)).toEqual(['meta:license']);
  });
});
