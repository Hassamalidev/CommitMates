import { describe, expect, it } from 'vitest';

import { MIN_ROUTED_FOR_RATE, NEUTRAL_RESPONSIVENESS, alumniCutoffYear, rankAlumni, responsiveness, routeScore } from './route';

describe('responsiveness', () => {
  it('is neutral until enough questions were routed, then the share answered', () => {
    expect(responsiveness({ routed: MIN_ROUTED_FOR_RATE - 1, answered: 0 })).toBe(NEUTRAL_RESPONSIVENESS);
    expect(responsiveness({ routed: 4, answered: 3 })).toBe(0.75);
    expect(responsiveness({ routed: 4, answered: 0 })).toBe(0);
  });
});

describe('routeScore', () => {
  it('weighs skill overlap by spare capacity and responsiveness, and is zero at the cap', () => {
    const vector = { react: 1, docker: 0 };
    const free = routeScore(['react'], vector, { open: 0, routed: 0, answered: 0 }, 3);
    const busy = routeScore(['react'], vector, { open: 2, routed: 0, answered: 0 }, 3);
    expect(free).toBeCloseTo(0.5);
    expect(busy).toBeCloseTo(0.5 / 3);
    expect(routeScore(['react'], vector, { open: 3, routed: 0, answered: 0 }, 3)).toBe(0);
    expect(routeScore(['go'], vector, { open: 0, routed: 0, answered: 0 }, 3)).toBe(0);
    expect(routeScore(['react'], vector, { open: 0, routed: 10, answered: 10 }, 3)).toBeCloseTo(1);
    expect(routeScore(['react'], vector, { open: 0, routed: 0, answered: 0 }, 0)).toBe(0);
  });
});

describe('alumniCutoffYear', () => {
  it('moves to this year once the transition month starts', () => {
    expect(alumniCutoffYear(new Date('2026-06-30T23:00:00Z'), 7)).toBe(2025);
    expect(alumniCutoffYear(new Date('2026-07-01T00:00:00Z'), 7)).toBe(2026);
    expect(alumniCutoffYear(new Date('2026-12-31T00:00:00Z'), 7)).toBe(2026);
  });
});

describe('rankAlumni', () => {
  const load = { open: 0, routed: 0, answered: 0 };
  it('takes the best matches, skips alumni at their cap and falls back to availability', () => {
    const candidates = [
      { id: 'c', vector: { go: 1 }, ...load },
      { id: 'a', vector: { react: 1 }, ...load, open: 1 },
      { id: 'b', vector: { react: 1 }, ...load },
      { id: 'd', vector: { react: 1 }, ...load, open: 2 },
      { id: 'e', vector: { go: 1 }, open: 0, routed: 4, answered: 4 },
    ];
    expect(rankAlumni(['react'], candidates, 2, 3)).toEqual(['b', 'a', 'e']);
    expect(rankAlumni([], candidates, 2, 2)).toEqual(['e', 'b']);
    expect(rankAlumni(['react'], candidates, 0, 3)).toEqual([]);
    expect(rankAlumni(['react'], candidates, 2, 0)).toEqual([]);
  });
});
