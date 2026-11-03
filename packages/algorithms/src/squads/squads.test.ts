import { describe, expect, it } from 'vitest';

import { centroidTags, chooseClusters, densify, kMeans, silhouette, squaredDistance } from './cluster';
import { HOURS_PER_WEEK, availabilitySlots, formSquads, type SquadCandidate } from './form';

describe('densify and distance', () => {
  it('lays vectors over the sorted union of their tags', () => {
    expect(densify([{ react: 1 }, { go: 0.5, react: 0.2 }])).toEqual({
      tags: ['go', 'react'],
      points: [
        [0, 1],
        [0.5, 0.2],
      ],
    });
    expect(squaredDistance([0, 0], [3, 4])).toBe(25);
  });
});

describe('kMeans and silhouette', () => {
  const points = [
    [0, 0],
    [0, 0.1],
    [0.1, 0],
    [5, 5],
    [5, 5.1],
    [5.1, 5],
  ];

  it('separates two clear groups, the same way for the same seed', () => {
    const first = kMeans(points, 2, 42, 50);
    const again = kMeans(points, 2, 42, 50);
    expect(first).toEqual(again);
    const [a, , , d] = first.assignments;
    expect(first.assignments.slice(0, 3).every((cluster) => cluster === a)).toBe(true);
    expect(first.assignments.slice(3).every((cluster) => cluster === d)).toBe(true);
    expect(a).not.toBe(d);
    expect(silhouette(points, first.assignments)).toBeGreaterThan(0.9);
  });

  it('scores a mixed-up clustering low and lone points as 0', () => {
    expect(silhouette(points, [0, 1, 0, 1, 0, 1])).toBeLessThan(0);
    expect(
      silhouette(
        [
          [0, 0],
          [1, 1],
        ],
        [0, 1],
      ),
    ).toBe(0);
    expect(silhouette([], [])).toBe(0);
  });

  it('chooses k by silhouette within [2, n ÷ 2] and falls back to one cluster', () => {
    const three = [...points, [10, 0], [10, 0.1], [10.1, 0]];
    expect(chooseClusters(three, 6, 7, 50).k).toBe(3);
    expect(chooseClusters(three, 2, 7, 50).k).toBe(2);
    const single = chooseClusters([[1, 0], [0, 1], [1, 1]], 6, 7, 50);
    expect(single).toMatchObject({ k: 1, assignments: [0, 0, 0], silhouette: 0 });
    expect(single.centroids[0]?.map((value) => Number(value.toFixed(3)))).toEqual([0.667, 0.667]);
    expect(chooseClusters([], 6, 7, 50)).toMatchObject({ k: 1, assignments: [] });
  });

  it('seeds well even when points repeat, and keeps an emptied centroid', () => {
    const same = [
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ];
    const clustering = kMeans(same, 2, 3, 10);
    expect(clustering.assignments).toEqual([0, 0, 0, 0]);
    expect(clustering.centroids).toHaveLength(2);
  });

  it('names a role by the heaviest centroid tags', () => {
    expect(centroidTags([0.2, 0, 0.9, 0.2], ['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'a']);
    expect(centroidTags([0, 0], ['a', 'b'], 2)).toEqual([]);
  });
});

describe('availabilitySlots', () => {
  it('reads blocks in the member’s timezone against the event week', () => {
    // A Monday, 00:00 UTC.
    const weekStart = new Date('2026-10-19T00:00:00Z');
    const utc = availabilitySlots([{ weekday: 1, from: 9, to: 11 }], 'UTC', weekStart);
    expect([...utc]).toEqual([9, 10]);
    // 09:00–11:00 in Karachi (UTC+5) is 04:00–06:00 UTC.
    expect([...availabilitySlots([{ weekday: 1, from: 9, to: 11 }], 'Asia/Karachi', weekStart)]).toEqual([4, 5]);
    expect(availabilitySlots([{ weekday: 0, from: 0, to: 24 }], 'UTC', weekStart).size).toBe(24);
    expect(HOURS_PER_WEEK).toBe(168);
  });
});

const candidate = (id: string, role: number | null, extra: Partial<SquadCandidate> = {}): SquadCandidate => ({ id, role, activity: null, slots: null, group: null, ...extra });

describe('formSquads', () => {
  it('covers every role in each team before doubling up', () => {
    const people = [candidate('a1', 0), candidate('a2', 0), candidate('b1', 1), candidate('b2', 1), candidate('c1', 2), candidate('c2', 2)];
    const teams = formSquads(people, { teamSize: 3, roleCount: 3, minOverlapHours: 4 });
    expect(teams).toHaveLength(2);
    for (const team of teams) expect(new Set(team.map((id) => id[0]))).toEqual(new Set(['a', 'b', 'c']));
    // Deterministic for the same input.
    expect(formSquads([...people].reverse(), { teamSize: 3, roleCount: 3, minOverlapHours: 4 })).toEqual(teams);
  });

  it('gives a scarce role to the team that can still use it, whatever the id order', () => {
    // Team 1 holds a locked pair of role 0; role 1 is scarce (two people) and nobody else has role 0.
    for (const [first, second] of [
      ['a-pg', 'z-pg'],
      ['z-pg', 'a-pg'],
    ] as const) {
      const people = [
        candidate('g1', 0, { group: 'x' }),
        candidate('g2', 0, { group: 'x' }),
        candidate(first, 1),
        candidate(second, 1),
        candidate('n1', null),
        candidate('n2', null),
      ];
      const teams = formSquads(people, { teamSize: 3, roleCount: 2, minOverlapHours: 0 });
      const withGroup = teams.find((team) => team.includes('g1'));
      expect(withGroup?.some((id) => id.endsWith('-pg'))).toBe(true);
      const other = teams.find((team) => !team.includes('g1'));
      expect(other?.some((id) => id.endsWith('-pg'))).toBe(true);
    }
  });

  it('keeps locked groups together, each in its own team', () => {
    const people = [
      candidate('g1', 0, { group: 'x' }),
      candidate('g2', 0, { group: 'x' }),
      candidate('h1', 1, { group: 'y' }),
      candidate('p1', 1),
      candidate('p2', 0),
      candidate('p3', 1),
    ];
    const teams = formSquads(people, { teamSize: 3, roleCount: 2, minOverlapHours: 0 });
    expect(teams).toHaveLength(2);
    const withX = teams.find((team) => team.includes('g1'));
    expect(withX).toContain('g2');
    expect(withX).not.toContain('h1');
    expect(withX).toHaveLength(3);
    // The group lacking role 1 gets someone who covers it.
    expect(withX?.some((id) => id === 'p1' || id === 'p3')).toBe(true);
    // More groups than teams join the smallest team.
    const crowded = formSquads([candidate('q1', 0, { group: 'a' }), candidate('q2', 0, { group: 'b' })], { teamSize: 4, roleCount: 1, minOverlapHours: 0 });
    expect(crowded).toEqual([['q1', 'q2']]);
  });

  it('prefers people whose free hours overlap the team’s, and falls back when nobody fits', () => {
    const morning = new Set([1, 2, 3, 4, 5]);
    const evening = new Set([20, 21, 22, 23, 24]);
    const people = [
      candidate('a', 0, { slots: morning }),
      candidate('b', 0, { slots: evening }),
      candidate('c', 1, { slots: morning }),
      candidate('d', 1, { slots: evening }),
    ];
    const teams = formSquads(people, { teamSize: 2, roleCount: 2, minOverlapHours: 4 });
    expect(teams.map((team) => [...team].sort())).toEqual(expect.arrayContaining([['a', 'c'], ['b', 'd']]));
    const stuck = formSquads([candidate('a', 0, { slots: morning }), candidate('b', 1, { slots: evening })], { teamSize: 2, roleCount: 2, minOverlapHours: 4 });
    expect(stuck).toEqual([['a', 'b']]);
  });

  it('breaks ties toward the event’s mean activity, and handles members without roles', () => {
    const people = [candidate('high', 0, { activity: 1 }), candidate('low', 0, { activity: 0 }), candidate('mid', 0, { activity: 0.5 }), candidate('none', null)];
    const teams = formSquads(people, { teamSize: 2, roleCount: 1, minOverlapHours: 0 });
    expect(teams).toHaveLength(2);
    expect(teams.flat().sort()).toEqual(['high', 'low', 'mid', 'none']);
    expect(teams[0]).toContain('mid');
    expect(formSquads([], { teamSize: 3, roleCount: 1, minOverlapHours: 0 })).toEqual([]);
  });
});
