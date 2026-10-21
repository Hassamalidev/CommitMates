import { describe, expect, it } from 'vitest';

import { teachLevels } from '../matching/teach';

import { findSwapCycles, selectSwapCycles, swapEdges, type SwapOffer, type SwapWant } from './cycles';

const offer = (member: string, tag: string, level = 1, verified = true): SwapOffer => ({ member, tag, level, verified });
const want = (member: string, tag: string, priority = 1): SwapWant => ({ member, tag, priority });
const HALF = { selfDeclaredFactor: 0.5 };

describe('swapEdges', () => {
  it('links an offer to every want of the same tag, never to oneself, keeping the best edge per pair', () => {
    const edges = swapEdges(
      [offer('a', 'react', 0.6), offer('a', 'flutter', 0.9), offer('b', 'go', 0.8), offer('a', 'go', 1)],
      [want('b', 'react', 1), want('b', 'flutter', 0.5), want('a', 'go', 1)],
      HALF,
    );
    expect(edges).toEqual([
      { from: 'a', to: 'b', tag: 'react', quality: 0.6, verified: true },
      { from: 'b', to: 'a', tag: 'go', quality: 0.8, verified: true },
    ]);
  });

  it('counts self-declared offers at the given factor, and drops pairs that are not allowed', () => {
    const offers = [offer('a', 'rust', 0.8, false), offer('c', 'rust', 0.8)];
    const wants = [want('b', 'rust', 1)];
    expect(swapEdges(offers, wants, HALF).map((edge) => [edge.from, edge.quality, edge.verified])).toEqual([
      ['a', 0.4, false],
      ['c', 0.8, true],
    ]);
    expect(swapEdges(offers, wants, { ...HALF, allowed: (x, y) => !(x === 'c' && y === 'b') }).map((edge) => edge.from)).toEqual(['a']);
  });

  it('breaks quality ties by tag, whatever the input order', () => {
    const forward = swapEdges([offer('a', 'zig'), offer('a', 'ada')], [want('b', 'zig'), want('b', 'ada')], HALF);
    const backward = swapEdges([offer('a', 'ada'), offer('a', 'zig')], [want('b', 'ada'), want('b', 'zig')], HALF);
    expect(forward).toEqual(backward);
    expect(forward[0]?.tag).toBe('ada');
  });
});

describe('findSwapCycles', () => {
  const edges = swapEdges(
    [offer('a', 'react', 0.9), offer('b', 'go', 0.6), offer('b', 'rust', 0.9), offer('c', 'sql', 0.6), offer('d', 'css', 1)],
    [want('b', 'react'), want('a', 'go'), want('c', 'rust'), want('a', 'sql'), want('a', 'css')],
    HALF,
  );

  it('finds 2-cycles and, within the length limit, 3-cycles, each once', () => {
    const cycles = findSwapCycles(edges, 3);
    expect(cycles.map((cycle) => cycle.members)).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]);
    expect(cycles[0]?.score).toBeCloseTo(0.75);
    expect(cycles[1]?.edges.map((edge) => `${edge.from}>${edge.to}:${edge.tag}`)).toEqual(['a>b:react', 'b>c:rust', 'c>a:sql']);
    expect(cycles[1]?.score).toBeCloseTo(0.8);
  });

  it('stops at the length limit and ignores one-way edges', () => {
    expect(findSwapCycles(edges, 2).map((cycle) => cycle.members)).toEqual([['a', 'b']]);
    expect(findSwapCycles(swapEdges([offer('d', 'css')], [want('a', 'css')], HALF), 3)).toEqual([]);
    expect(findSwapCycles([], 3)).toEqual([]);
  });
});

describe('selectSwapCycles', () => {
  it('takes the best cycles first and never puts a member in two', () => {
    const cycles = [
      { members: ['a', 'b'], edges: [], score: 0.75 },
      { members: ['a', 'b', 'c'], edges: [], score: 0.8 },
      { members: ['d', 'e'], edges: [], score: 0.3 },
      { members: ['c', 'd'], edges: [], score: 0.5 },
    ];
    expect(selectSwapCycles(cycles).map((cycle) => cycle.members)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
  });

  it('prefers shorter cycles, then member order, on equal scores', () => {
    const cycles = [
      { members: ['a', 'b', 'c'], edges: [], score: 0.5 },
      { members: ['b', 'd'], edges: [], score: 0.5 },
      { members: ['a', 'c'], edges: [], score: 0.5 },
    ];
    expect(selectSwapCycles(cycles).map((cycle) => cycle.members)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });
});

describe('teachLevels', () => {
  it('ranks each member’s weight in a tag among everyone at the university, absent tags counting as 0', () => {
    const levels = teachLevels(
      new Map([
        ['a', { react: 0.9, go: 0.1 }],
        ['b', { react: 0.3 }],
        ['c', {}],
        ['d', { react: 0 }],
      ]),
    );
    expect(levels.get('a')?.get('react')).toBeCloseTo(0.875);
    expect(levels.get('b')?.get('react')).toBeCloseTo(0.625);
    expect(levels.get('a')?.get('go')).toBeCloseTo(0.875);
    expect(levels.get('c')?.size).toBe(0);
    expect(levels.get('d')?.has('react')).toBe(false);
  });
});
